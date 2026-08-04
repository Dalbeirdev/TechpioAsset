import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  deriveLicenseStatus,
  shouldEscalateWorkOrder,
  expiryBucket,
  expiryState,
  isHighUtilization,
  isWarrantyAlertable,
  seatsAvailable,
  warrantyBucket,
} from '@techpioasset/domain';
import { AuditAction, Prisma } from '@prisma/client';
import { AppConfig } from '../config/config.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AssetHealthService } from '../asset-health/asset-health.service.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { withSpan } from '../observability/tracing.js';

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
/** Matches the warning window the batch list reports against. */
const EXPIRY_WARN_DAYS = 30;

@Injectable()
export class AlertSweepService implements OnModuleInit {
  private readonly logger = new Logger(AlertSweepService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly maintenance: MaintenanceService,
    private readonly assetHealth: AssetHealthService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('ENABLE_SCHEDULED_JOBS')) return;
    // Run shortly after boot, then daily. A cron system (BullMQ repeatable jobs)
    // would replace this in a clustered deployment; a single timer is correct for
    // one instance and keeps the dev path dependency-free.
    const daily = () => {
      // One span per nightly pass, so a slow or failing sweep is visible
      // rather than inferred from log timestamps.
      void withSpan('sweep.daily', async () => {
      void this.runWarrantySweep();
      void this.runApprovalEscalationSweep();
      void this.runLicenseSweep();
      void this.runStockSweep();
      void this.runExpirySweep();
      void this.runWorkOrderSweep();
      void this.runHealthSweep();
      void this.runDiscoveryStalenessSweep();
      });
    };
    this.timer = setInterval(daily, 24 * 60 * 60 * 1000);
    this.timer.unref?.();
    setTimeout(daily, 5000).unref?.();
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

  /**
   * v2.2 Workstream D — escalates approval steps whose SLA has lapsed.
   *
   * A PENDING step past its `slaDueAt` is escalated to the request's manager (or
   * the requester's line manager) with an APPROVAL_ESCALATED notification, and
   * marked `escalatedAt` so it escalates exactly once however often the sweep runs.
   */
  async runApprovalEscalationSweep(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.client.requestApproval.findMany({
      where: { decision: 'PENDING', escalatedAt: null, slaDueAt: { lt: now } },
      select: {
        id: true,
        stepName: true,
        requestId: true,
        request: {
          select: {
            companyId: true,
            managerId: true,
            requester: { select: { profile: { select: { managerId: true } } } },
          },
        },
      },
    });

    let raised = 0;
    for (const approval of overdue) {
      const recipientId =
        approval.request.managerId ?? approval.request.requester.profile?.managerId ?? null;
      if (recipientId) {
        await this.notifications.notify({
          companyId: approval.request.companyId,
          userId: recipientId,
          type: 'APPROVAL_ESCALATED',
          title: 'Approval overdue',
          body: `The "${approval.stepName}" approval step has passed its SLA and needs attention.`,
          linkPath: `/requests/${approval.requestId}`,
          entityType: 'AssetRequest',
          entityId: approval.requestId,
        });
        raised += 1;
      }
      // Mark escalated regardless of whether a recipient existed, so an
      // orphaned step is not rescanned on every sweep.
      await this.prisma.client.requestApproval.update({
        where: { id: approval.id },
        data: { escalatedAt: now },
      });
    }

    if (raised > 0) this.logger.log(`Approval escalation sweep raised ${raised} alert(s)`);
    return raised;
  }

  /**
   * v2.3 L6 — licence housekeeping in one daily pass:
   * 1. refresh each licence's cached status from its expiry date;
   * 2. raise LICENSE_EXPIRING inside the 90/60/30-day buckets (once a day);
   * 3. raise SEAT_LIMIT_REACHED when a pool is full or at >=90% utilisation;
   * 4. reconcile the seat counter against actual ACTIVE assignments and WARN on
   *    drift - the counter stays authoritative for the limit, assignments for
   *    "who", and a mismatch means a bug worth investigating, not hiding.
   */
  async runLicenseSweep(
    now: Date = new Date(),
  ): Promise<{ expiring: number; capacity: number; drift: number }> {
    const licenses = await this.prisma.client.softwareLicense.findMany({
      where: { deletedAt: null, status: { not: 'RETIRED' } },
      select: {
        id: true,
        companyId: true,
        name: true,
        status: true,
        expiryDate: true,
        seatsPurchased: true,
        createdById: true,
        updatedById: true,
        pools: { select: { id: true, seatsAllocated: true, seatsReserved: true } },
      },
    });

    let expiring = 0;
    let capacity = 0;
    let drift = 0;

    for (const license of licenses) {
      // 1. Cached status follows the calendar.
      const derived = deriveLicenseStatus(license.expiryDate, now);
      if (derived !== license.status) {
        await this.prisma.client.softwareLicense.update({
          where: { id: license.id },
          data: { status: derived },
        });
      }

      const recipientId = license.createdById ?? license.updatedById;

      // 2. Expiry buckets.
      if (license.expiryDate && recipientId) {
        const bucket = expiryBucket(license.expiryDate, now);
        if (bucket && !(await this.alreadyAlertedToday(license.id, 'LICENSE_EXPIRING', now))) {
          await this.notifications.notify({
            companyId: license.companyId,
            userId: recipientId,
            type: 'LICENSE_EXPIRING',
            title: `License expiring: ${license.name}`,
            body: `${license.name} expires ${license.expiryDate.toDateString()} (within ${bucket} days). Plan the renewal.`,
            linkPath: `/licenses/${license.id}`,
            entityType: 'SoftwareLicense',
            entityId: license.id,
          });
          expiring += 1;
        }
      }

      // 3 + 4. Seat capacity and counter drift, per pool.
      for (const pool of license.pools) {
        const active = await this.prisma.client.licenseAssignment.count({
          where: { seatPoolId: pool.id, status: 'ACTIVE' },
        });
        if (active !== pool.seatsReserved) {
          drift += 1;
          this.logger.warn(
            `Seat counter drift on license ${license.id} pool ${pool.id}: reserved=${pool.seatsReserved}, active=${active}`,
          );
        }

        if (
          recipientId &&
          isHighUtilization(pool.seatsAllocated, pool.seatsReserved) &&
          !(await this.alreadyAlertedToday(license.id, 'SEAT_LIMIT_REACHED', now))
        ) {
          const free = seatsAvailable(pool.seatsAllocated, pool.seatsReserved);
          await this.notifications.notify({
            companyId: license.companyId,
            userId: recipientId,
            type: 'SEAT_LIMIT_REACHED',
            title: `License seats ${free === 0 ? 'exhausted' : 'nearly exhausted'}: ${license.name}`,
            body:
              free === 0
                ? `Every one of ${pool.seatsAllocated} seats is assigned. New assignments will be refused until seats are added or reclaimed.`
                : `Only ${free} of ${pool.seatsAllocated} seats remain.`,
            linkPath: `/licenses/${license.id}`,
            entityType: 'SoftwareLicense',
            entityId: license.id,
          });
          capacity += 1;
        }
      }
    }

    if (expiring + capacity + drift > 0) {
      this.logger.log(
        `License sweep: ${expiring} expiring alert(s), ${capacity} capacity alert(s), ${drift} drift warning(s)`,
      );
    }
    return { expiring, capacity, drift };
  }

  /**
   * v2.4 P7 - warehouse housekeeping in one daily pass:
   * 1. reconcile every StockLevel cache against the signed sum of its ledger
   *    and WARN on drift - never silently repair (the ledger is the truth and
   *    a mismatch is a bug to investigate, exactly like seat counters);
   * 2. raise LOW_STOCK for locations at or below the item minimum, once a day
   *    (catches levels that drifted low without a triggering mutation).
   */
  /**
   * The nightly stock pass: ledger-vs-cache drift, and low-stock alerts.
   *
   * v2.10 S3 — this used to load every stock level, then for EACH ONE load
   * every movement ever recorded for that item and location and sum them in
   * JavaScript. At 100,000 levels that is 100,000 round trips: 45 seconds
   * against a local database, and far worse across a network.
   *
   * Now the ledger is summed by the database, one grouped query per batch of
   * levels. The batch is what keeps memory bounded — a tenant with millions of
   * pairs must not need all of them resident at once — and BATCH_SIZE is the
   * stated bound.
   *
   * The arithmetic is unchanged: the SQL CASE is generated from the same sign
   * map the JavaScript used, so the two cannot drift apart. A movement type
   * with no sign still counts as zero, exactly as `sign[m.type] ?? 0` did.
   */
  async runStockSweep(now: Date = new Date()): Promise<{ drift: number; lowStock: number }> {
    /** How many stock levels are held in memory, and summed, at a time. */
    const BATCH_SIZE = 5_000;

    let drift = 0;
    let lowStock = 0;
    let cursor: string | undefined;

    // One query for the whole day's LOW_STOCK notifications instead of one per
    // low level: the old code asked the database "did I already warn about this
    // one?" separately for every level that was low.
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const alertedToday = new Set(
      (
        await this.prisma.client.notification.findMany({
          where: { type: 'LOW_STOCK', createdAt: { gte: startOfDay } },
          select: { entityId: true },
        })
      ).map((n) => n.entityId),
    );

    for (;;) {
      const levels = await this.prisma.client.stockLevel.findMany({
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        select: {
          id: true,
          companyId: true,
          quantity: true,
          inventoryItemId: true,
          stockLocationId: true,
          inventoryItem: { select: { name: true, minStock: true, createdById: true } },
          stockLocation: { select: { name: true } },
        },
      });
      if (levels.length === 0) break;
      cursor = levels.at(-1)!.id;

      const balances = await this.ledgerBalances(levels);

      for (const level of levels) {
        const balance = balances.get(`${level.inventoryItemId}:${level.stockLocationId}`) ?? 0;
        if (balance !== Number(level.quantity)) {
          drift += 1;
          this.logger.warn(
            `Stock ledger drift on level ${level.id}: cache=${Number(level.quantity)}, ledger=${balance}`,
          );
        }

        const min = level.inventoryItem.minStock;
        const recipientId = level.inventoryItem.createdById;
        if (
          min !== null &&
          Number(level.quantity) <= Number(min) &&
          recipientId &&
          !alertedToday.has(level.id)
        ) {
          await this.notifications.notify({
            companyId: level.companyId,
            userId: recipientId,
            type: 'LOW_STOCK',
            title: `Low stock: ${level.inventoryItem.name}`,
            body: `${level.stockLocation.name} is down to ${Number(level.quantity)} (minimum ${Number(min)}).`,
            linkPath: '/inventory',
            entityType: 'StockLevel',
            entityId: level.id,
          });
          // Within one run the same level must not be alerted twice either.
          alertedToday.add(level.id);
          lowStock += 1;
        }
      }

      if (levels.length < BATCH_SIZE) break;
    }

    if (drift + lowStock > 0) {
      this.logger.log(`Stock sweep: ${drift} drift warning(s), ${lowStock} low-stock alert(s)`);
    }
    return { drift, lowStock };
  }

  /**
   * The signed value of each movement type, and the single source of truth for
   * it. A type absent from this map contributes nothing — which is deliberate
   * for COUNT_CORRECTION, and was the behaviour of `sign[m.type] ?? 0` before.
   */
  private static readonly MOVEMENT_SIGN: Readonly<Record<string, 1 | -1>> = {
    RECEIPT: 1,
    ISSUE: -1,
    ADJUST_UP: 1,
    ADJUST_DOWN: -1,
    TRANSFER_IN: 1,
    TRANSFER_OUT: -1,
    CONVERT_TO_ASSET: -1,
  };

  /** Ledger balance per item/location pair, summed by the database. */
  private async ledgerBalances(
    levels: readonly { inventoryItemId: string; stockLocationId: string }[],
  ): Promise<Map<string, number>> {
    const signs = AlertSweepService.MOVEMENT_SIGN;
    // Generated from the map above so the SQL and the JS can never disagree.
    const positive = Object.keys(signs).filter((t) => signs[t] === 1);
    const negative = Object.keys(signs).filter((t) => signs[t] === -1);
    const caseSql = Prisma.sql`
      CASE
        WHEN "type"::text IN (${Prisma.join(positive)}) THEN "quantity"
        WHEN "type"::text IN (${Prisma.join(negative)}) THEN -"quantity"
        ELSE 0
      END`;

    const pairs = Prisma.join(
      levels.map((l) => Prisma.sql`(${l.inventoryItemId}, ${l.stockLocationId})`),
    );
    const rows = await this.prisma.client.$queryRaw<
      { inventoryItemId: string; stockLocationId: string; balance: string | number }[]
    >(Prisma.sql`
      SELECT "inventoryItemId", "stockLocationId", SUM(${caseSql}) AS balance
        FROM "stock_movements"
       WHERE ("inventoryItemId", "stockLocationId") IN (${pairs})
       GROUP BY "inventoryItemId", "stockLocationId"`);

    return new Map(rows.map((r) => [`${r.inventoryItemId}:${r.stockLocationId}`, Number(r.balance)]));
  }

  /**
   * v2.9 C4 - lots about to go off, and lots that already have.
   *
   * Expiry is the one stock problem nobody discovers by looking: the number on
   * the shelf does not change on the day it stops being usable. So the sweep
   * says so, once per lot per day, while there is still time to use it up.
   */
  async runExpirySweep(now: Date = new Date()): Promise<{ expiring: number; expired: number }> {
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + EXPIRY_WARN_DAYS);

    const batches = await this.prisma.client.stockBatch.findMany({
      where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: horizon } },
      orderBy: { expiryDate: 'asc' },
      select: {
        id: true,
        companyId: true,
        batchNumber: true,
        quantity: true,
        expiryDate: true,
        inventoryItem: { select: { name: true, createdById: true } },
        stockLocation: { select: { name: true } },
      },
    });

    let expiring = 0;
    let expired = 0;
    for (const batch of batches) {
      const state = expiryState(batch, now, EXPIRY_WARN_DAYS);
      if (state !== 'EXPIRED' && state !== 'EXPIRING_SOON') continue;
      const recipientId = batch.inventoryItem.createdById;
      if (!recipientId) continue;
      if (await this.alreadyAlertedToday(batch.id, 'STOCK_EXPIRING', now)) continue;

      const day = batch.expiryDate!.toISOString().slice(0, 10);
      await this.notifications.notify({
        companyId: batch.companyId,
        userId: recipientId,
        type: 'STOCK_EXPIRING',
        title:
          state === 'EXPIRED'
            ? `Expired stock: ${batch.inventoryItem.name}`
            : `Stock expiring: ${batch.inventoryItem.name}`,
        body:
          `Lot ${batch.batchNumber} at ${batch.stockLocation.name} holds ${Number(batch.quantity)} ` +
          (state === 'EXPIRED' ? `and expired on ${day}.` : `and expires on ${day}.`),
        linkPath: '/inventory',
        entityType: 'StockBatch',
        entityId: batch.id,
      });
      if (state === 'EXPIRED') expired += 1;
      else expiring += 1;
    }

    if (expiring + expired > 0) {
      this.logger.log(`Expiry sweep: ${expiring} expiring soon, ${expired} already expired`);
    }
    return { expiring, expired };
  }

  /**
   * v2.5 H3 — work-order housekeeping in one daily pass:
   * 1. spawn work orders for due preventive schedules (idempotent: the due date
   *    advances strictly into the future in the same transaction);
   * 2. escalate overdue work orders EXACTLY ONCE (the approvals pattern):
   *    notify, audit, stamp escalatedAt.
   */
  async runWorkOrderSweep(now: Date = new Date()): Promise<{ spawned: number; escalated: number }> {
    const spawned = await this.maintenance.spawnDueSchedules(now);

    const candidates = await this.prisma.client.maintenanceRecord.findMany({
      where: {
        escalatedAt: null,
        slaDueAt: { lt: now },
        status: { in: ['SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'] },
      },
      select: {
        id: true,
        title: true,
        status: true,
        slaDueAt: true,
        escalatedAt: true,
        technicianId: true,
        requestedById: true,
        asset: { select: { companyId: true, assetTag: true, createdById: true } },
      },
    });

    let escalated = 0;
    for (const order of candidates) {
      if (!shouldEscalateWorkOrder(order, now)) continue;

      // The technician on the hook first; the requester, then whoever manages
      // the asset, as fallbacks.
      const recipientId = order.technicianId ?? order.requestedById ?? order.asset.createdById;
      if (recipientId) {
        await this.notifications.notify({
          companyId: order.asset.companyId,
          userId: recipientId,
          type: 'WORK_ORDER_ESCALATED',
          title: `Work order overdue: ${order.title}`,
          body: `${order.asset.assetTag}: the SLA deadline (${order.slaDueAt?.toDateString()}) has passed.`,
          linkPath: `/maintenance/${order.id}`,
          entityType: 'MaintenanceRecord',
          entityId: order.id,
        });
      }
      await this.audit.record({
        companyId: order.asset.companyId,
        action: AuditAction.WORK_ORDER_ESCALATED,
        entityType: 'MaintenanceRecord',
        entityId: order.id,
        newValues: { slaDueAt: order.slaDueAt, status: order.status },
      });
      // Stamp regardless of recipient so an orphaned order is not rescanned.
      await this.prisma.client.maintenanceRecord.update({
        where: { id: order.id },
        data: { escalatedAt: now },
      });
      escalated += 1;
    }

    if (spawned > 0 || escalated > 0) {
      this.logger.log(`Work-order sweep spawned ${spawned}, escalated ${escalated}`);
    }
    return { spawned, escalated };
  }

  /**
   * v2.5 H7 - discovery staleness. A machine last reported more than 30 days
   * ago is running blind: its health score rests on old facts. The sweep WARNS
   * (it never fabricates a fresher picture) and returns the stale count so
   * operators and tests can see it.
   */
  async runDiscoveryStalenessSweep(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 30 * 86_400_000);
    const stale = await this.prisma.client.hardwareProfile.findMany({
      where: { lastDiscoveredAt: { lt: cutoff }, asset: { deletedAt: null } },
      select: { assetId: true, lastDiscoveredAt: true, asset: { select: { assetTag: true } } },
    });
    for (const profile of stale) {
      this.logger.warn(
        `Discovery stale: ${profile.asset.assetTag} last reported ` +
          `${profile.lastDiscoveredAt.toISOString().slice(0, 10)} (>30 days) - health rests on old facts`,
      );
    }
    return stale.length;
  }

  /** v2.5 H4 - daily recompute keeps every cached health score honest. */
  async runHealthSweep(now: Date = new Date()): Promise<number> {
    return this.assetHealth.recomputeAll(now);
  }

  private async alreadyAlertedToday(
    entityId: string,
    type:
      | 'WARRANTY_EXPIRATION'
      | 'MAINTENANCE_DUE'
      | 'LICENSE_EXPIRING'
      | 'SEAT_LIMIT_REACHED'
      | 'LOW_STOCK'
      | 'STOCK_EXPIRING',
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
