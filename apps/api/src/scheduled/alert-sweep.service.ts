import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { warrantyBucket, isWarrantyAlertable } from '@techpioasset/domain';
import { AppConfig } from '../config/config.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Warranty and maintenance alert sweep (spec section 14).
 *
 * Finds assets whose warranty falls in the 30/60/90-day windows and raises a
 * WARRANTY_EXPIRATION notification, and finds maintenance due today or overdue
 * and raises MAINTENANCE_DUE. Runs on a timer when ENABLE_SCHEDULED_JOBS is set,
 * and is also exposed as a method so it can be triggered and tested directly.
 *
 * De-duplication: it will not raise a second alert for the same asset+window
 * inside a day, so a sweep that runs hourly does not spam.
 */
@Injectable()
export class AlertSweepService implements OnModuleInit {
  private readonly logger = new Logger(AlertSweepService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('ENABLE_SCHEDULED_JOBS')) return;
    // Run shortly after boot, then daily. A cron system (BullMQ repeatable jobs)
    // would replace this in a clustered deployment; a single timer is correct for
    // one instance and keeps the dev path dependency-free.
    this.timer = setInterval(() => void this.runWarrantySweep(), 24 * 60 * 60 * 1000);
    this.timer.unref?.();
    setTimeout(() => void this.runWarrantySweep(), 5000).unref?.();
  }

  /**
   * Raises warranty-expiry alerts. Returns the number raised, so a test can
   * assert the sweep did its job.
   */
  async runWarrantySweep(now: Date = new Date()): Promise<number> {
    const horizon = new Date(now.getTime() + 91 * 86_400_000);

    const assets = await this.prisma.client.asset.findMany({
      where: {
        deletedAt: null,
        warrantyEndDate: { gte: now, lte: horizon },
        status: { notIn: ['DISPOSED', 'DONATED', 'RETIRED'] },
      },
      select: {
        id: true,
        companyId: true,
        assetTag: true,
        name: true,
        warrantyEndDate: true,
        assignedUserId: true,
        createdById: true,
      },
    });

    let raised = 0;
    for (const asset of assets) {
      const bucket = warrantyBucket(asset.warrantyEndDate, now);
      if (!isWarrantyAlertable(bucket)) continue;

      if (await this.alreadyAlertedToday(asset.id, 'WARRANTY_EXPIRATION', now)) continue;

      // Notify whoever holds the asset, or whoever created it (typically IT).
      const recipientId = asset.assignedUserId ?? asset.createdById;
      if (!recipientId) continue;

      await this.notifications.notify({
        companyId: asset.companyId,
        userId: recipientId,
        type: 'WARRANTY_EXPIRATION',
        title: `Warranty expiring: ${asset.name}`,
        body: `${asset.assetTag}'s warranty ends ${asset.warrantyEndDate?.toDateString()} (${bucket.replace('WITHIN_', 'within ')} days).`,
        linkPath: `/assets/${asset.id}`,
        entityType: 'Asset',
        entityId: asset.id,
      });
      raised += 1;
    }

    if (raised > 0) this.logger.log(`Warranty sweep raised ${raised} alert(s)`);
    return raised;
  }

  /** Raises maintenance-due alerts for work scheduled today or overdue. */
  async runMaintenanceSweep(now: Date = new Date()): Promise<number> {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const due = await this.prisma.client.maintenanceRecord.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: endOfDay } },
      select: {
        id: true,
        title: true,
        requestedById: true,
        asset: { select: { companyId: true, assetTag: true } },
      },
    });

    let raised = 0;
    for (const record of due) {
      if (!record.requestedById) continue;
      if (await this.alreadyAlertedToday(record.id, 'MAINTENANCE_DUE', now)) continue;

      await this.notifications.notify({
        companyId: record.asset.companyId,
        userId: record.requestedById,
        type: 'MAINTENANCE_DUE',
        title: `Maintenance due: ${record.title}`,
        body: `Scheduled maintenance for ${record.asset.assetTag} is due.`,
        linkPath: `/maintenance/${record.id}`,
        entityType: 'MaintenanceRecord',
        entityId: record.id,
      });
      raised += 1;
    }

    return raised;
  }

  private async alreadyAlertedToday(
    entityId: string,
    type: 'WARRANTY_EXPIRATION' | 'MAINTENANCE_DUE',
    now: Date,
  ): Promise<boolean> {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const existing = await this.prisma.client.notification.findFirst({
      where: { entityId, type, createdAt: { gte: startOfDay } },
      select: { id: true },
    });
    return existing !== null;
  }
}
