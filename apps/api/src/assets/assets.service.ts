import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { AuditAction, Prisma, type Asset } from '@prisma/client';
import type {
  AssetListQuery,
  AssignAssetInput,
  AuthUser,
  CreateAssetInput,
  ReturnAssetInput,
  UpdateAssetInput,
} from '@techpioasset/contracts';
import {
  assertTransition,
  assetStatusMachine,
  ASSET_STATUSES_ASSIGNABLE,
  PERMISSIONS,
  requiresSerialNumber,
  type AssetStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { assetScopeFilter, canSeeCost, tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SORTABLE = ['createdAt', 'name', 'assetTag', 'status', 'purchaseDate'] as const;

/** Fields whose changes are worth an audit row. Excludes noise like updatedAt. */
const AUDITED_FIELDS = [
  'name',
  'assetTag',
  'serialNumber',
  'status',
  'condition',
  'categoryId',
  'assignedUserId',
  'officeId',
  'departmentId',
  'roomId',
  'vendorId',
  'purchaseCost',
  'currentValue',
  'warrantyEndDate',
] as const;

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  private selection(actor: AuthUser) {
    const showCost = canSeeCost(actor);
    return {
      id: true,
      assetTag: true,
      name: true,
      description: true,
      trackingType: true,
      brand: true,
      model: true,
      serialNumber: true,
      barcode: true,
      qrToken: true,
      status: true,
      condition: true,
      assignmentDate: true,
      expectedReturnDate: true,
      warrantyStartDate: true,
      warrantyEndDate: true,
      purchaseDate: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      // Cost columns are omitted from the query itself, not filtered afterwards,
      // so a value the actor may not see never leaves the database.
      purchaseCost: showCost,
      currentValue: showCost,
      currency: showCost,
      category: { select: { id: true, key: true, name: true, icon: true } },
      subcategory: { select: { id: true, name: true } },
      office: { select: { id: true, name: true } },
      room: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      assignedUser: {
        select: {
          id: true,
          email: true,
          profile: { select: { firstName: true, lastName: true, avatarKey: true } },
        },
      },
    } satisfies Prisma.AssetSelect;
  }

  async list(actor: AuthUser, query: AssetListQuery) {
    // Scope and caller-supplied filters are ANDed, never merged.
    //
    // Spreading them into one object let a later key silently replace an earlier
    // one: `?assignedUserId=<someone else>` overwrote the scope's own
    // `assignedUserId`, and an employee could read another employee's assets.
    // An integration test caught it. AND cannot be overridden by construction.
    const filters: Prisma.AssetWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.condition ? { condition: query.condition } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { assetTag: { contains: query.q, mode: 'insensitive' } },
              { serialNumber: { contains: query.q, mode: 'insensitive' } },
              { brand: { contains: query.q, mode: 'insensitive' } },
              { model: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const where: Prisma.AssetWhereInput = { AND: [assetScopeFilter(actor), filters] };

    return paginate(query, {
      count: () => this.prisma.client.asset.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.asset.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: this.selection(actor),
        }),
    });
  }

  /** 404 rather than 403 outside scope - see UsersService.findOne for why. */
  async findOne(actor: AuthUser, id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, ...assetScopeFilter(actor) },
      select: {
        ...this.selection(actor),
        notes: true,
        manufacturerPartNumber: true,
        expectedReplacementDate: true,
        assignments: {
          orderBy: { assignedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            assignedAt: true,
            returnedAt: true,
            conditionOut: true,
            acknowledgedAt: true,
            expectedReturnAt: true,
            user: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
            assetReturn: {
              select: { returnedAt: true, conditionIn: true, damageNotes: true },
            },
          },
        },
        conditionLogs: {
          orderBy: { recordedAt: 'desc' },
          take: 20,
          select: {
            id: true,
            recordedAt: true,
            previousStatus: true,
            newStatus: true,
            previousCondition: true,
            newCondition: true,
            reason: true,
          },
        },
      },
    });

    if (!asset) throw AppError.notFound('Asset', id);
    return asset;
  }

  /** Resolves a QR token to an asset, subject to the same scope rules. */
  async findByQrToken(actor: AuthUser, qrToken: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { qrToken, ...assetScopeFilter(actor) },
      select: this.selection(actor),
    });
    if (!asset) throw AppError.notFound('Asset');
    return asset;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Writes
  // ───────────────────────────────────────────────────────────────────────────

  async create(actor: AuthUser, input: CreateAssetInput) {
    if (requiresSerialNumber(input.trackingType) && input.serialNumber) {
      await this.assertSerialAvailable(actor, input.serialNumber, input.duplicateExceptionReason);
    }

    // Only cost-visible roles (Finance / Super Admin) may record a price; anyone
    // else registering an asset simply leaves it for Finance to price later.
    if (input.purchaseCost !== undefined && input.purchaseCost !== null && !canSeeCost(actor)) {
      throw new AppError('FORBIDDEN', 'Only Finance can set an asset price');
    }

    const asset = await this.prisma.client.asset.create({
      data: {
        companyId: actor.companyId,
        assetTag: input.assetTag,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        subcategoryId: input.subcategoryId ?? null,
        trackingType: input.trackingType,
        brand: input.brand ?? null,
        model: input.model ?? null,
        serialNumber: input.serialNumber ?? null,
        manufacturerPartNumber: input.manufacturerPartNumber ?? null,
        barcode: input.barcode ?? null,
        // Opaque and unguessable: the QR code carries this, never asset data.
        qrToken: ulid(),
        purchaseDate: input.purchaseDate ?? null,
        purchaseCost: input.purchaseCost ? new Prisma.Decimal(input.purchaseCost) : null,
        currency: input.currency ?? null,
        vendorId: input.vendorId ?? null,
        purchaseOrderNumber: input.purchaseOrderNumber ?? null,
        warrantyStartDate: input.warrantyStartDate ?? null,
        warrantyEndDate: input.warrantyEndDate ?? null,
        expectedReplacementDate: input.expectedReplacementDate ?? null,
        officeId: input.officeId ?? null,
        buildingId: input.buildingId ?? null,
        floorId: input.floorId ?? null,
        roomId: input.roomId ?? null,
        departmentId: input.departmentId ?? null,
        condition: input.condition,
        status: input.status,
        notes: input.notes ?? null,
        duplicateExceptionReason: input.duplicateExceptionReason ?? null,
        duplicateExceptionById: input.duplicateExceptionReason ? actor.id : null,
        createdById: actor.id,
        updatedById: actor.id,
      },
      select: this.selection(actor),
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_CREATED,
      entityType: 'Asset',
      entityId: asset.id,
      newValues: { assetTag: input.assetTag, name: input.name, status: input.status },
    });

    return asset;
  }

  /**
   * Price rules (product decision):
   * - Only cost-visible roles (Finance / Super Admin) may touch a price.
   * - Once recorded it is write-once: Finance cannot change it. Only a Super
   *   Admin (permissions:manage) may correct a genuine mistake, audit-logged.
   */
  private assertPriceChangeAllowed(actor: AuthUser, before: { purchaseCost?: unknown }): void {
    if (!canSeeCost(actor)) {
      throw new AppError('FORBIDDEN', 'Only Finance can set an asset price');
    }
    const hadCost = before.purchaseCost !== null && before.purchaseCost !== undefined;
    const isSuperAdmin = actor.permissions.includes(PERMISSIONS.PERMISSIONS_MANAGE);
    if (hadCost && !isSuperAdmin) {
      throw new AppError('FORBIDDEN', 'The price is already recorded and cannot be changed', {
        detail: 'Prices are entered once. Ask a Super Admin if a correction is needed.',
      });
    }
  }

  /**
   * Records an asset's price. A deliberately narrow write so Finance can price
   * an asset without holding the general assets:update permission — pricing is
   * their whole write surface, and it is write-once (see above).
   */
  async setPrice(actor: AuthUser, id: string, input: { purchaseCost: string; currency?: string }) {
    const before = await this.loadForWrite(actor, id);
    this.assertPriceChangeAllowed(actor, before as { purchaseCost?: unknown });

    const after = await this.prisma.client.asset.update({
      where: { id },
      data: {
        purchaseCost: new Prisma.Decimal(input.purchaseCost),
        ...(input.currency ? { currency: input.currency } : {}),
        updatedById: actor.id,
        version: { increment: 1 },
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_COST_CHANGED,
      entityType: 'Asset',
      entityId: id,
      previousValues: {
        purchaseCost: String((before as { purchaseCost?: unknown }).purchaseCost ?? ''),
      },
      newValues: { purchaseCost: input.purchaseCost },
    });

    void after;
    return this.findOne(actor, id);
  }

  async update(actor: AuthUser, id: string, input: UpdateAssetInput) {
    const before = await this.loadForWrite(actor, id);

    if (input.version !== undefined && input.version !== before.version) {
      throw new AppError(
        'CONCURRENT_MODIFICATION',
        'This asset was changed by someone else. Reload and try again.',
      );
    }

    if (input.serialNumber && input.serialNumber !== before.serialNumber) {
      await this.assertSerialAvailable(actor, input.serialNumber, input.duplicateExceptionReason);
    }

    // Status changes go through the state machine even on a general update, so
    // there is no back door around the transition rules.
    if (input.status && input.status !== before.status) {
      assertTransition(assetStatusMachine, before.status as AssetStatus, input.status);
    }

    // Price changes never ride along a general edit — they go through setPrice,
    // which enforces the write-once rule. This closes the back door where a role
    // with assets:update but no cost visibility could alter a price blind.
    if (input.purchaseCost !== undefined) {
      this.assertPriceChangeAllowed(actor, before as { purchaseCost?: unknown });
    }

    const { version: _ignored, purchaseCost, ...rest } = input;

    const after = await this.prisma.client.asset.update({
      where: { id },
      data: {
        ...rest,
        ...(purchaseCost !== undefined
          ? { purchaseCost: purchaseCost ? new Prisma.Decimal(purchaseCost) : null }
          : {}),
        updatedById: actor.id,
        version: { increment: 1 },
      },
    });

    await this.audit.recordChange(
      {
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.ASSET_UPDATED,
        entityType: 'Asset',
        entityId: id,
      },
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      AUDITED_FIELDS as unknown as readonly string[],
    );

    if (input.status && input.status !== before.status) {
      await this.recordConditionLog(id, before, after, 'Status changed');
    }

    return this.findOne(actor, id);
  }

  async changeStatus(actor: AuthUser, id: string, status: AssetStatus, reason?: string) {
    const before = await this.loadForWrite(actor, id);
    assertTransition(assetStatusMachine, before.status as AssetStatus, status);

    const after = await this.prisma.client.asset.update({
      where: { id },
      data: { status, updatedById: actor.id, version: { increment: 1 } },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_STATUS_CHANGED,
      entityType: 'Asset',
      entityId: id,
      previousValues: { status: before.status },
      newValues: { status },
      reason,
    });

    await this.recordConditionLog(id, before, after, reason);
    return this.findOne(actor, id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Assignment and return (spec section 12)
  // ───────────────────────────────────────────────────────────────────────────

  async assign(actor: AuthUser, id: string, input: AssignAssetInput) {
    const asset = await this.loadForWrite(actor, id);

    if (asset.trackingType !== 'INDIVIDUAL') {
      throw new AppError(
        'VALIDATION_FAILED',
        'Quantity-tracked stock is issued, not assigned. Use an inventory transaction.',
      );
    }
    if (!ASSET_STATUSES_ASSIGNABLE.includes(asset.status as AssetStatus)) {
      throw new AppError(
        'ILLEGAL_STATE_TRANSITION',
        `An asset that is ${asset.status} cannot be assigned. It must be available or reserved.`,
      );
    }

    const recipient = await this.prisma.client.user.findFirst({
      where: { id: input.userId, companyId: actor.companyId },
    });
    if (!recipient) throw AppError.notFound('User', input.userId);

    // One transaction: the assignment row, the asset's denormalised assignee and
    // its status must never disagree, which is exactly what a partial failure
    // here would produce.
    const assignment = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.assetAssignment.create({
        data: {
          assetId: id,
          userId: input.userId,
          assignedById: actor.id,
          expectedReturnAt: input.expectedReturnAt ?? null,
          conditionOut: input.conditionOut,
          accessoriesIssued: input.accessoriesIssued ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });

      await tx.asset.update({
        where: { id },
        data: {
          status: 'ASSIGNED',
          assignedUserId: input.userId,
          assignmentDate: created.assignedAt,
          expectedReturnDate: input.expectedReturnAt ?? null,
          condition: input.conditionOut,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });

      return created;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSIGNMENT_CREATED,
      entityType: 'Asset',
      entityId: id,
      previousValues: { status: asset.status, assignedUserId: asset.assignedUserId },
      newValues: { status: 'ASSIGNED', assignedUserId: input.userId, assignmentId: assignment.id },
    });

    return this.findOne(actor, id);
  }

  /** Employee confirms receipt (spec section 12: capture acknowledgment). */
  async acknowledgeAssignment(actor: AuthUser, assignmentId: string) {
    const assignment = await this.prisma.client.assetAssignment.findFirst({
      where: { id: assignmentId, asset: tenantFilter(actor) },
    });
    if (!assignment) throw AppError.notFound('Assignment', assignmentId);

    // Only the holder may confirm receipt. An administrator acknowledging on
    // someone's behalf would make the record worthless as evidence.
    if (assignment.userId !== actor.id) {
      throw AppError.forbidden('Only the assignee can confirm receipt of an asset');
    }
    if (assignment.acknowledgedAt) return { acknowledgedAt: assignment.acknowledgedAt };

    const updated = await this.prisma.client.assetAssignment.update({
      where: { id: assignmentId },
      data: {
        acknowledgedAt: new Date(),
        acknowledgementMethod: 'IN_APP',
        acknowledgementIp: null,
        updatedById: actor.id,
      },
    });

    await this.prisma.client.asset.update({
      where: { id: assignment.assetId },
      data: { status: 'IN_USE', updatedById: actor.id, version: { increment: 1 } },
    });

    return { acknowledgedAt: updated.acknowledgedAt };
  }

  async return(actor: AuthUser, id: string, input: ReturnAssetInput) {
    const asset = await this.loadForWrite(actor, id);

    const open = await this.prisma.client.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    if (!open) {
      throw new AppError('VALIDATION_FAILED', 'This asset has no open assignment to return');
    }

    assertTransition(assetStatusMachine, asset.status as AssetStatus, 'RETURNED');
    assertTransition(assetStatusMachine, 'RETURNED', input.resultingStatus);

    await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();
      await tx.assetAssignment.update({
        where: { id: open.id },
        data: { returnedAt: now, updatedById: actor.id },
      });
      await tx.assetReturn.create({
        data: {
          assignmentId: open.id,
          returnedAt: now,
          receivedById: actor.id,
          conditionIn: input.conditionIn,
          missingAccessories: input.missingAccessories ?? null,
          damageNotes: input.damageNotes ?? null,
          resultingStatus: input.resultingStatus,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });
      await tx.asset.update({
        where: { id },
        data: {
          status: input.resultingStatus,
          condition: input.conditionIn,
          assignedUserId: null,
          assignmentDate: null,
          expectedReturnDate: null,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });
      await tx.assetConditionLog.create({
        data: {
          assetId: id,
          previousCondition: asset.condition,
          newCondition: input.conditionIn,
          previousStatus: asset.status,
          newStatus: input.resultingStatus,
          reason: 'Returned',
          createdById: actor.id,
        },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSIGNMENT_RETURNED,
      entityType: 'Asset',
      entityId: id,
      previousValues: { status: asset.status, assignedUserId: asset.assignedUserId },
      newValues: { status: input.resultingStatus, conditionIn: input.conditionIn },
    });

    return this.findOne(actor, id);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Loads an asset for mutation.
   *
   * Deliberately uses the tenant filter rather than the scope filter: a write is
   * already gated by a permission, and scoping it would let an employee's OWN
   * scope silently authorise editing their own asset.
   */
  private async loadForWrite(actor: AuthUser, id: string): Promise<Asset> {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, ...tenantFilter(actor) },
    });
    if (!asset) throw AppError.notFound('Asset', id);
    return asset;
  }

  private async assertSerialAvailable(
    actor: AuthUser,
    serialNumber: string,
    exceptionReason: string | undefined,
  ): Promise<void> {
    const existing = await this.prisma.client.asset.findFirst({
      where: { companyId: actor.companyId, serialNumber },
      select: { id: true, assetTag: true },
    });
    if (!existing) return;

    if (!exceptionReason) {
      throw new AppError(
        'DUPLICATE_SERIAL_NUMBER',
        `Serial number ${serialNumber} is already recorded on asset ${existing.assetTag}`,
        {
          detail:
            'Supply duplicateExceptionReason to record a documented exception (spec section 6).',
        },
      );
    }

    if (!actor.permissions.includes(PERMISSIONS.ASSETS_UPDATE)) {
      throw AppError.forbidden('You are not authorised to record a duplicate-serial exception');
    }
  }

  private async recordConditionLog(
    assetId: string,
    before: Asset,
    after: Asset,
    reason?: string,
  ): Promise<void> {
    await this.prisma.client.assetConditionLog.create({
      data: {
        assetId,
        previousStatus: before.status,
        newStatus: after.status,
        previousCondition: before.condition,
        newCondition: after.condition,
        reason: reason ?? null,
        createdById: after.updatedById,
      },
    });
  }
}
