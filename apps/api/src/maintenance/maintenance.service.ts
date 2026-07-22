import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AuthUser,
  CreateMaintenanceInput,
  MaintenanceListQuery,
} from '@techpioasset/contracts';
import {
  assertTransition,
  maintenanceStatusMachine,
  repairRecommendation,
  type MaintenanceStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { canSeeCost, tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: AuthUser, query: MaintenanceListQuery) {
    const where: Prisma.MaintenanceRecordWhereInput = {
      asset: tenantFilter(actor),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const showCost = canSeeCost(actor);
    return paginate(query, {
      count: () => this.prisma.client.maintenanceRecord.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.maintenanceRecord.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            title: true,
            scheduledFor: true,
            completedAt: true,
            replacementRecommended: true,
            createdAt: true,
            // Cost is omitted from the query for actors without cost permission.
            serviceCost: showCost,
            currency: showCost,
            downtimeHours: showCost,
            asset: { select: { id: true, assetTag: true, name: true } },
            vendor: { select: { id: true, name: true } },
          },
        }),
    });
  }

  async findOne(actor: AuthUser, id: string) {
    const showCost = canSeeCost(actor);
    const record = await this.prisma.client.maintenanceRecord.findFirst({
      where: { id, asset: tenantFilter(actor) },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        description: true,
        isInternal: true,
        scheduledFor: true,
        startedAt: true,
        completedAt: true,
        resolutionNotes: true,
        replacementRecommended: true,
        recommendationNote: true,
        serviceCost: showCost,
        currency: showCost,
        downtimeHours: showCost,
        createdAt: true,
        asset: {
          select: { id: true, assetTag: true, name: true, status: true, purchaseCost: showCost },
        },
        vendor: { select: { id: true, name: true } },
      },
    });
    if (!record) throw AppError.notFound('Maintenance record', id);
    return record;
  }

  async create(actor: AuthUser, input: CreateMaintenanceInput) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: input.assetId, ...tenantFilter(actor) },
      select: { id: true, status: true },
    });
    if (!asset) throw AppError.notFound('Asset', input.assetId);

    const record = await this.prisma.client.maintenanceRecord.create({
      data: {
        assetId: input.assetId,
        type: input.type,
        status: input.scheduledFor ? 'SCHEDULED' : 'REQUESTED',
        title: input.title,
        description: input.description ?? null,
        requestedById: actor.id,
        vendorId: input.vendorId ?? null,
        isInternal: input.isInternal,
        scheduledFor: input.scheduledFor ?? null,
        createdById: actor.id,
      },
      select: { id: true },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: record.id,
      newValues: { assetId: input.assetId, type: input.type, title: input.title },
    });

    return this.findOne(actor, record.id);
  }

  async schedule(actor: AuthUser, id: string, scheduledFor: Date) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'SCHEDULED');

    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: { status: 'SCHEDULED', scheduledFor, updatedById: actor.id },
    });

    // Tell whoever raised it that a date is set.
    if (record.requestedById) {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: record.requestedById,
        type: 'MAINTENANCE_DUE',
        title: `Maintenance scheduled: ${record.title}`,
        body: `Scheduled for ${scheduledFor.toDateString()}.`,
        linkPath: `/maintenance/${id}`,
        entityType: 'MaintenanceRecord',
        entityId: id,
      });
    }

    return this.findOne(actor, id);
  }

  /**
   * Starts work: moves the record IN_PROGRESS and takes the asset UNDER_REPAIR,
   * so the asset's own status reflects that it is out of service.
   */
  async start(actor: AuthUser, id: string) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'IN_PROGRESS');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.maintenanceRecord.update({
        where: { id },
        data: { status: 'IN_PROGRESS', startedAt: new Date(), updatedById: actor.id },
      });
      // Only move the asset if the transition is legal from its current status.
      const asset = await tx.asset.findUnique({
        where: { id: record.assetId },
        select: { status: true },
      });
      if (asset && asset.status !== 'UNDER_REPAIR') {
        try {
          const { assetStatusMachine, assertTransition: at } = await import('@techpioasset/domain');
          at(assetStatusMachine, asset.status, 'UNDER_REPAIR');
          await tx.asset.update({
            where: { id: record.assetId },
            data: { status: 'UNDER_REPAIR', updatedById: actor.id, version: { increment: 1 } },
          });
        } catch {
          // Asset cannot legally go under repair from its current state; leave it.
        }
      }
    });

    return this.findOne(actor, id);
  }

  async complete(
    actor: AuthUser,
    id: string,
    input: {
      serviceCost?: string | null;
      currency?: string | null;
      downtimeHours?: string | null;
      resolutionNotes?: string | null;
      replacementRecommended: boolean;
      recommendationNote?: string | null;
      restoreAsset: boolean;
    },
  ) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'COMPLETED');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.maintenanceRecord.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          serviceCost: input.serviceCost ? new Prisma.Decimal(input.serviceCost) : null,
          currency: input.currency ?? null,
          downtimeHours: input.downtimeHours ? new Prisma.Decimal(input.downtimeHours) : null,
          resolutionNotes: input.resolutionNotes ?? null,
          replacementRecommended: input.replacementRecommended,
          recommendationNote: input.recommendationNote ?? null,
          updatedById: actor.id,
        },
      });

      // Restore the asset to AVAILABLE if requested and legal.
      if (input.restoreAsset) {
        const asset = await tx.asset.findUnique({
          where: { id: record.assetId },
          select: { status: true },
        });
        if (asset?.status === 'UNDER_REPAIR') {
          await tx.asset.update({
            where: { id: record.assetId },
            data: {
              status: 'AVAILABLE',
              condition: 'GOOD',
              updatedById: actor.id,
              version: { increment: 1 },
            },
          });
        }
      }
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_UPDATED,
      entityType: 'MaintenanceRecord',
      entityId: id,
      newValues: { status: 'COMPLETED', serviceCost: input.serviceCost ?? null },
    });

    return this.findOne(actor, id);
  }

  async cancel(actor: AuthUser, id: string) {
    const record = await this.loadForWrite(actor, id);
    assertTransition(maintenanceStatusMachine, record.status as MaintenanceStatus, 'CANCELLED');
    await this.prisma.client.maintenanceRecord.update({
      where: { id },
      data: { status: 'CANCELLED', updatedById: actor.id },
    });
    return this.findOne(actor, id);
  }

  /**
   * Repair-vs-replace guidance for one asset (spec section 14). Available only to
   * cost-permitted actors, since it exposes financial figures.
   */
  async repairAdvice(actor: AuthUser, assetId: string, repairCost: string) {
    if (!canSeeCost(actor)) throw AppError.forbidden('You may not view cost comparisons');
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: assetId, ...tenantFilter(actor) },
      select: { purchaseCost: true, currentValue: true },
    });
    if (!asset) throw AppError.notFound('Asset', assetId);

    const replacement = asset.currentValue ?? asset.purchaseCost ?? new Prisma.Decimal(0);
    return repairRecommendation({ repairCost, replacementCost: replacement.toString() });
  }

  private async loadForWrite(actor: AuthUser, id: string) {
    const record = await this.prisma.client.maintenanceRecord.findFirst({
      where: { id, asset: tenantFilter(actor) },
    });
    if (!record) throw AppError.notFound('Maintenance record', id);
    return record;
  }
}
