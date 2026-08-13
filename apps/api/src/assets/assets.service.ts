import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';
import { AuditAction, Prisma, type Asset } from '@prisma/client';
import type {
  AssetListQuery,
  AssignAssetInput,
  AuthUser,
  CreateAssetInput,
  PageQuery,
  ReassignAssetInput,
  ReturnAssetInput,
  DisposeAssetInput,
  ReceiveTransferInput,
  TransferAssetInput,
  UpdateAssetInput,
} from '@techpioasset/contracts';
import {
  assertTransition,
  IllegalTransitionError,
  assetStatusMachine,
  ASSET_STATUSES_ASSIGNABLE,
  detectWarrantyVendor,
  PERMISSIONS,
  requiresSerialNumber,
  type AssetStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { assetScopeFilter, canSeeCost, canSeeVendor, tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AiConfigService } from '../ai-config/ai-config.service.js';
import { RoutingAiProvider } from '../providers/ai/routing-ai.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';

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
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly aiConfig: AiConfigService,
    private readonly ai: RoutingAiProvider,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Reads
  // ───────────────────────────────────────────────────────────────────────────

  private selection(actor: AuthUser) {
    const showCost = canSeeCost(actor);
    // Who supplied the device is procurement's business, not the holder's.
    // Omitted from the query itself, like cost, so a value the actor may not
    // see never leaves the database.
    const showVendor = canSeeVendor(actor);
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
      // v2.1 Workstream A — the four status dimensions (null until backfilled/dual-written).
      lifecycleState: true,
      availabilityState: true,
      ownershipType: true,
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
      vendor: showVendor ? ({ select: { id: true, name: true } } as const) : (false as const),
      assignedUser: {
        select: {
          id: true,
          email: true,
          profile: { select: { firstName: true, lastName: true, avatarKey: true } },
        },
      },
      // The open assignment only - one row, so the holder can confirm receipt
      // from a list without opening each device. Bounded by `take`, and closed
      // assignments (the device's whole history) never ride along.
      assignments: {
        where: { returnedAt: null },
        orderBy: { assignedAt: 'desc' },
        take: 1,
        select: {
          id: true,
          acknowledgedAt: true,
          expectedReturnAt: true,
          // Who handed the device over - accountability the holder should see.
          assignedBy: {
            select: { id: true, profile: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    } satisfies Prisma.AssetSelect;
  }

  /**
   * Scope and caller-supplied filters, ANDed (never merged).
   *
   * Spreading them into one object let a later key silently replace an earlier
   * one: `?assignedUserId=<someone else>` overwrote the scope's own
   * `assignedUserId`, and an employee could read another employee's assets. An
   * integration test caught it. AND cannot be overridden by construction.
   */
  private listWhere(actor: AuthUser, query: AssetListQuery): Prisma.AssetWhereInput {
    const filters: Prisma.AssetWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.condition ? { condition: query.condition } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      // v2.1 Workstream A — dimension filters, ANDed like the rest (AST-051).
      ...(query.lifecycleState ? { lifecycleState: query.lifecycleState } : {}),
      ...(query.availabilityState ? { availabilityState: query.availabilityState } : {}),
      ...(query.ownershipType ? { ownershipType: query.ownershipType } : {}),
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
    return { AND: [assetScopeFilter(actor), filters] };
  }

  async list(actor: AuthUser, query: AssetListQuery) {
    const where = this.listWhere(actor, query);

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

  /**
   * All assets matching the list filters, flattened for CSV export. Honours the
   * caller's scope and cost visibility; capped so an export can't become an
   * unbounded scan. Cost is a column only when the caller may see it.
   */
  async exportRows(
    actor: AuthUser,
    query: AssetListQuery,
  ): Promise<{ columns: { key: string; label: string }[]; rows: Record<string, string>[] }> {
    const where = this.listWhere(actor, query);
    const showCost = canSeeCost(actor);
    const assets = await this.prisma.client.asset.findMany({
      where,
      take: 10_000,
      orderBy: { assetTag: 'asc' },
      select: this.selection(actor),
    });

    const columns = [
      { key: 'assetTag', label: 'Asset tag' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'condition', label: 'Condition' },
      { key: 'serialNumber', label: 'Serial number' },
      { key: 'office', label: 'Office' },
      { key: 'assignedTo', label: 'Assigned to' },
      ...(showCost ? [{ key: 'purchaseCost', label: 'Purchase cost' }] : []),
    ];

    const rows = assets.map((a) => {
      const holder = (a as { assignedUser?: { email?: string } | null }).assignedUser;
      const cost = (a as { purchaseCost?: unknown }).purchaseCost;
      return {
        assetTag: a.assetTag,
        name: a.name,
        category: (a as { category?: { name?: string } | null }).category?.name ?? '',
        status: a.status,
        condition: a.condition,
        serialNumber: a.serialNumber ?? '',
        office: (a as { office?: { name?: string } | null }).office?.name ?? '',
        assignedTo: holder?.email ?? '',
        ...(showCost ? { purchaseCost: cost != null ? String(cost) : '' } : {}),
      };
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.DATA_EXPORTED,
      entityType: 'Asset',
      entityId: 'export',
      newValues: {
        rows: rows.length,
        filters: { q: query.q ?? null, status: query.status ?? null },
      },
    });

    return { columns, rows };
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
            accessoriesIssued: true,
            assignedBy: {
              select: { id: true, profile: { select: { firstName: true, lastName: true } } },
            },
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
        // v2.5 H4 — what discovery knows about this machine, and the derived
        // health. All null/empty until an agent or connector has reported.
        hardwareProfile: true,
        osInfo: true,
        health: {
          select: {
            overall: true,
            grade: true,
            subScores: true,
            recommendations: true,
            capped: true,
            computedAt: true,
          },
        },
        _count: { select: { installedSoftware: true } },
        // The open transfer, if the asset is on the road - one row, so the
        // detail page can say where it is heading and offer "confirm arrival".
        transfers: {
          where: { receivedAt: null },
          orderBy: { transferredAt: 'desc' },
          take: 1,
          select: {
            id: true,
            transferredAt: true,
            reason: true,
            fromOffice: { select: { id: true, name: true } },
            toOffice: { select: { id: true, name: true } },
          },
        },
        // End of life, if it has one. Proceeds are money and follow the same
        // rule as every other price: Finance and Super Admin only.
        disposal: {
          select: {
            method: true,
            disposedAt: true,
            proceeds: canSeeCost(actor),
            currency: canSeeCost(actor),
            recipient: true,
            reason: true,
            approvedBy: {
              select: { id: true, profile: { select: { firstName: true, lastName: true } } },
            },
          },
        },
      },
    });

    if (!asset) throw AppError.notFound('Asset', id);

    // Counted, not measured: `assignments` is capped at 20 above, so deriving
    // the total from its length reported a device assigned 30 times as 20.
    // "This device has been assigned N times" is the one number an employee
    // is shown about its past, so it has to be the real one.
    const assignmentCount = await this.prisma.client.assetAssignment.count({
      where: { assetId: id },
    });

    // OWN-scope viewers (employees looking at their own device) get the
    // device's history without their colleagues' identities: their own
    // assignment rows stay named, everyone else's collapse to "assigned
    // before" - plus a count, so "this device has been assigned 3 times"
    // stays answerable (v2.12 least-privilege audit, G3). Damage notes on
    // other people's returns are internal detail and go with the name.
    if (actor.scope === 'OWN') {
      return {
        ...asset,
        // Notes stay visible to the device's holder (owner decision,
        // 2026-08-12): they carry the device's specs and known problems, and
        // an OWN-scope viewer can only ever fetch their own asset. The flip
        // side is deliberate too - remarks IT wants kept from the holder
        // belong in maintenance records, not the asset's notes box.
        assignmentCount,
        assignments: asset.assignments.map((assignment) =>
          assignment.user?.id === actor.id
            ? assignment
            : {
                ...assignment,
                user: null,
                assignedBy: null,
                assetReturn: assignment.assetReturn
                  ? { ...assignment.assetReturn, damageNotes: null }
                  : null,
              },
        ),
      };
    }
    return { ...asset, assignmentCount };
  }

  /** v2.5 H4 — the discovered software inventory, paginated (Software tab). */
  async listSoftware(actor: AuthUser, id: string, query: PageQuery) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, ...assetScopeFilter(actor) },
      select: { id: true },
    });
    if (!asset) throw AppError.notFound('Asset', id);
    return paginate(query, {
      count: () => this.prisma.client.installedSoftware.count({ where: { assetId: id } }),
      findMany: ({ skip, take }) =>
        this.prisma.client.installedSoftware.findMany({
          where: { assetId: id },
          orderBy: { name: 'asc' },
          skip,
          take,
          select: {
            id: true,
            name: true,
            version: true,
            publisher: true,
            installedAt: true,
            lastDiscoveredAt: true,
          },
        }),
    });
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

    // v2.6 A3: integrations may care about new assets.
    void this.webhooks.publish(actor.companyId, 'asset.created', {
      assetId: asset.id,
      assetTag: input.assetTag,
      name: input.name,
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

  /**
   * Warranty paste-and-extract (v2.16): proposes a warranty end date from text
   * the technician pasted off the manufacturer's warranty page. Proposal only —
   * nothing is saved here; the technician confirms and the ordinary update path
   * (with its audit entry) records the date. Every call passes the AI gate
   * first and lands in the usage ledger either way.
   */
  async extractWarranty(actor: AuthUser, id: string, text: string) {
    const asset = await this.loadForWrite(actor, id);

    const gate = await this.aiConfig.gate(actor.companyId, 'WARRANTY_EXTRACTION', {
      officeId: actor.officeId,
      roleKeys: actor.roles,
    });
    if (!gate.enabled) {
      throw new AppError('AI_DISABLED', 'AI warranty extraction is switched off', {
        detail:
          gate.reason === 'GLOBALLY_DISABLED' || gate.reason === 'PAUSED'
            ? 'AI is disabled for this company. A Super Admin can enable it under Settings → AI.'
            : 'The warranty extraction feature is disabled. A Super Admin can enable it under Settings → AI.',
      });
    }

    const hw = await this.prisma.client.asset.findFirst({
      where: { id: asset.id },
      select: { hardwareProfile: { select: { manufacturer: true } } },
    });
    const vendor = detectWarrantyVendor(
      hw?.hardwareProfile?.manufacturer,
      asset.brand,
      asset.model,
      asset.name,
    );

    try {
      const result = await this.ai.extractWarrantyText({
        text,
        serialNumber: asset.serialNumber,
        vendorLabel: vendor?.label ?? null,
      });
      await this.aiConfig.recordUsage({
        companyId: actor.companyId,
        userId: actor.id,
        feature: 'WARRANTY_EXTRACTION',
        provider: result.provider,
        modelName: result.modelName,
        entityType: 'Asset',
        entityId: asset.id,
        confidence: result.confidence,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        succeeded: true,
        simulated: result.simulated,
      });
      return result;
    } catch (error) {
      const effective = await this.ai.effective().catch(() => null);
      await this.aiConfig.recordUsage({
        companyId: actor.companyId,
        userId: actor.id,
        feature: 'WARRANTY_EXTRACTION',
        provider: effective?.provider ?? 'unknown',
        entityType: 'Asset',
        entityId: asset.id,
        succeeded: false,
        simulated: false,
        failureDetail: (error as Error).message,
      });
      throw error;
    }
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

  /**
   * Applies one status change to many assets. Each asset runs through the same
   * validated single-asset path, so scope, the state machine, and audit logging
   * are identical to changing them one by one. Failures (e.g. an illegal
   * transition for one asset) are collected per-id rather than aborting the whole
   * batch — the caller sees exactly what went through and what didn't.
   */
  async changeStatusBulk(
    actor: AuthUser,
    ids: string[],
    status: AssetStatus,
    reason?: string,
  ): Promise<{ succeeded: string[]; failed: { id: string; reason: string }[] }> {
    const succeeded: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    // De-duplicate so a repeated id can't be double-counted.
    for (const id of [...new Set(ids)]) {
      try {
        await this.changeStatus(actor, id, status, reason);
        succeeded.push(id);
      } catch (error) {
        failed.push({
          id,
          reason:
            error instanceof AppError || error instanceof IllegalTransitionError
              ? error.message
              : 'Could not update this asset',
        });
      }
    }

    return { succeeded, failed };
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

    await this.announceAssignment({
      companyId: actor.companyId,
      userId: input.userId,
      assetId: id,
      assetTag: asset.assetTag,
      assetName: asset.name,
      expectedReturnAt: input.expectedReturnAt ?? null,
    });

    return this.findOne(actor, id);
  }

  /**
   * Tells the new holder a device is theirs (spec section 19).
   *
   * ASSET_ASSIGNED is a mandatory notification and nothing had ever emitted it:
   * an asset could be booked out against someone's name without that person
   * being told, which makes the receipt confirmation we then chase them for
   * unanswerable. Failures are logged, not thrown - the handover has already
   * committed, and losing a message is not a reason to claim it did not happen.
   */
  private async announceAssignment(input: {
    companyId: string;
    userId: string;
    assetId: string;
    assetTag: string;
    assetName: string;
    expectedReturnAt: Date | null;
  }): Promise<void> {
    const due = input.expectedReturnAt
      ? ` Please return it by ${input.expectedReturnAt.toDateString()}.`
      : '';
    try {
      await this.notifications.notify({
        companyId: input.companyId,
        userId: input.userId,
        type: 'ASSET_ASSIGNED',
        title: `${input.assetName} is now assigned to you`,
        body: `${input.assetTag} has been issued to you.${due} Please confirm you have received it.`,
        linkPath: '/my-assets',
        entityType: 'Asset',
        entityId: input.assetId,
      });
    } catch (error) {
      this.logger.error(
        `Assigned ${input.assetTag} but could not notify ${input.userId}: ${(error as Error).message}`,
      );
    }
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

    // The acknowledgement is the evidence that a device reached a person, and
    // it was the one custody event that left no audit trail. A receipt nobody
    // can produce later is not a receipt.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.RECEIPT_ACKNOWLEDGED,
      entityType: 'Asset',
      entityId: assignment.assetId,
      newValues: {
        assignmentId: assignment.id,
        acknowledgedAt: updated.acknowledgedAt,
        method: 'IN_APP',
      },
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

  /**
   * Hand a device from its current holder straight to the next one (v2.15).
   *
   * The same two records a return and an assignment would write, in ONE
   * transaction. Doing it as two API calls left a window where the asset
   * belonged to nobody - and if the second call failed, a device that was
   * meant to move had simply vanished from its owner instead.
   *
   * The intermediate RETURNED status is asserted exactly as the two-step path
   * does, so an asset that may not be returned may not be reassigned either.
   */
  async reassign(actor: AuthUser, id: string, input: ReassignAssetInput) {
    const asset = await this.loadForWrite(actor, id);

    const open = await this.prisma.client.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    if (!open) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This asset is not assigned to anyone. Assign it instead of reassigning it.',
      );
    }
    if (open.userId === input.userId) {
      throw new AppError('VALIDATION_FAILED', 'That person already holds this asset');
    }

    const recipient = await this.prisma.client.user.findFirst({
      where: { id: input.userId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!recipient) throw AppError.notFound('User', input.userId);

    // Every hop is checked before anything is written. A handover is the same
    // journey the two-call flow makes - back to the shelf, then out again - so
    // it walks the same three transitions rather than teaching the state
    // machine a shortcut that would let any returned asset skip availability.
    assertTransition(assetStatusMachine, asset.status as AssetStatus, 'RETURNED');
    assertTransition(assetStatusMachine, 'RETURNED', 'AVAILABLE');
    assertTransition(assetStatusMachine, 'AVAILABLE', 'ASSIGNED');

    const conditionOut = input.conditionOut ?? input.conditionIn;

    await this.prisma.client.$transaction(async (tx) => {
      const now = new Date();

      // 1. Close the outgoing holder's assignment with a real return record,
      //    so the previous custody is as well documented as any other return.
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
          damageNotes: input.damageNotes ?? null,
          resultingStatus: 'ASSIGNED',
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });

      // 2. Open the incoming holder's assignment.
      await tx.assetAssignment.create({
        data: {
          assetId: id,
          userId: input.userId,
          assignedById: actor.id,
          assignedAt: now,
          expectedReturnAt: input.expectedReturnAt ?? null,
          conditionOut,
          accessoriesIssued: input.accessoriesIssued ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });

      await tx.asset.update({
        where: { id },
        data: {
          status: 'ASSIGNED',
          condition: conditionOut,
          assignedUserId: input.userId,
          assignmentDate: now,
          expectedReturnDate: input.expectedReturnAt ?? null,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });

      await tx.assetConditionLog.create({
        data: {
          assetId: id,
          previousCondition: asset.condition,
          newCondition: conditionOut,
          previousStatus: asset.status,
          newStatus: 'ASSIGNED',
          reason: 'Reassigned',
          createdById: actor.id,
        },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_TRANSFERRED,
      entityType: 'Asset',
      entityId: id,
      previousValues: { assignedUserId: open.userId, status: asset.status },
      newValues: { assignedUserId: input.userId, status: 'ASSIGNED', conditionIn: input.conditionIn },
      reason: 'Reassigned directly to a new holder',
    });

    await this.announceAssignment({
      companyId: actor.companyId,
      userId: input.userId,
      assetId: id,
      assetTag: asset.assetTag,
      assetName: asset.name,
      expectedReturnAt: input.expectedReturnAt ?? null,
    });

    return this.findOne(actor, id);
  }

  /**
   * Records an asset's end of life (spec section 22, v2.15).
   *
   * A disposal is recorded, never a delete: the DisposalRecord carries the
   * method, date, recipient and reason, and the asset row stays for its
   * history. The unique assetId on the record is what makes "disposed twice"
   * structurally impossible rather than merely checked.
   */
  async dispose(actor: AuthUser, id: string, input: DisposeAssetInput) {
    const asset = await this.loadForWrite(actor, id);

    // Custody first. Disposing a device someone still holds would write a
    // clean-looking record over an unreturned laptop.
    const open = await this.prisma.client.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
      select: { id: true },
    });
    if (open) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This asset is still assigned to someone. Record its return before disposing of it.',
      );
    }

    // DONATED is its own terminal state; everything else lands in DISPOSED.
    const target: AssetStatus = input.method === 'DONATED' ? 'DONATED' : 'DISPOSED';
    assertTransition(assetStatusMachine, asset.status as AssetStatus, target);

    if (input.disposedAt.getTime() > Date.now() + 86_400_000) {
      throw new AppError('VALIDATION_FAILED', 'The disposal date cannot be in the future');
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.disposalRecord.create({
        data: {
          assetId: id,
          method: input.method,
          disposedAt: input.disposedAt,
          proceeds: input.proceeds ?? null,
          currency: input.proceeds ? (input.currency ?? 'USD') : null,
          recipient: input.recipient ?? null,
          reason: input.reason,
          approvedById: actor.id,
          createdById: actor.id,
        },
      });

      await tx.asset.update({
        where: { id },
        data: { status: target, updatedById: actor.id, version: { increment: 1 } },
      });

      await tx.assetConditionLog.create({
        data: {
          assetId: id,
          previousCondition: asset.condition,
          newCondition: asset.condition,
          previousStatus: asset.status,
          newStatus: target,
          reason: `Disposed: ${input.method.toLowerCase().replace(/_/g, ' ')}`,
          createdById: actor.id,
        },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.DISPOSAL_RECORDED,
      entityType: 'Asset',
      entityId: id,
      previousValues: { status: asset.status },
      newValues: {
        status: target,
        method: input.method,
        disposedAt: input.disposedAt,
        recipient: input.recipient ?? null,
        // Proceeds belong in the audit log - it is the record a disposal
        // dispute reaches for, and its readers already hold audit:read.
        proceeds: input.proceeds ?? null,
      },
      reason: input.reason,
    });

    return this.findOne(actor, id);
  }

  /**
   * Sends an asset to another office (v2.15 Phase 2d).
   *
   * AssetTransfer existed in the schema from v1 and nothing ever wrote a row;
   * IN_TRANSIT was a status no code path could reach. An office move was a
   * silent officeId edit - the asset was never "between" anywhere, which is
   * precisely where equipment disappears.
   *
   * The asset stays attributed to the origin office until the destination
   * confirms arrival: a laptop in a courier van is not at either site.
   */
  async transfer(actor: AuthUser, id: string, input: TransferAssetInput) {
    const asset = await this.loadForWrite(actor, id);

    const open = await this.prisma.client.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: null },
      select: { id: true },
    });
    if (open) {
      throw new AppError(
        'VALIDATION_FAILED',
        'This asset is assigned to someone. Office transfers move stock; a person changing offices keeps their equipment through their own record.',
      );
    }
    if (asset.officeId === input.toOfficeId) {
      throw new AppError('VALIDATION_FAILED', 'The asset is already at that office');
    }

    const destination = await this.prisma.client.office.findFirst({
      where: { id: input.toOfficeId, companyId: actor.companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!destination) throw AppError.notFound('Office', input.toOfficeId);

    assertTransition(assetStatusMachine, asset.status as AssetStatus, 'IN_TRANSIT');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.assetTransfer.create({
        data: {
          assetId: id,
          transferType: 'OFFICE',
          fromOfficeId: asset.officeId,
          toOfficeId: input.toOfficeId,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          condition: asset.condition,
          approvedById: actor.id,
          createdById: actor.id,
        },
      });
      await tx.asset.update({
        where: { id },
        data: { status: 'IN_TRANSIT', updatedById: actor.id, version: { increment: 1 } },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_TRANSFERRED,
      entityType: 'Asset',
      entityId: id,
      previousValues: { status: asset.status, officeId: asset.officeId },
      newValues: { status: 'IN_TRANSIT', toOfficeId: input.toOfficeId },
      reason: input.reason ?? `Dispatched to ${destination.name}`,
    });

    return this.findOne(actor, id);
  }

  /** Destination confirms arrival; only now does the officeId change hands. */
  async receiveTransfer(actor: AuthUser, id: string, input: ReceiveTransferInput) {
    const asset = await this.loadForWrite(actor, id);

    const transfer = await this.prisma.client.assetTransfer.findFirst({
      where: { assetId: id, receivedAt: null, transferType: 'OFFICE' },
      orderBy: { transferredAt: 'desc' },
      select: { id: true, toOfficeId: true },
    });
    if (!transfer || !transfer.toOfficeId) {
      throw new AppError('VALIDATION_FAILED', 'This asset has no transfer waiting to be received');
    }

    assertTransition(assetStatusMachine, asset.status as AssetStatus, input.resultingStatus);

    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.assetTransfer.update({
        where: { id: transfer.id },
        data: { receivedAt: now, receivedById: actor.id },
      });
      await tx.asset.update({
        where: { id },
        data: {
          status: input.resultingStatus,
          officeId: transfer.toOfficeId,
          // Rooms belong to offices; the old room does not exist at the new site.
          roomId: null,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_TRANSFERRED,
      entityType: 'Asset',
      entityId: id,
      previousValues: { status: asset.status, officeId: asset.officeId },
      newValues: { status: input.resultingStatus, officeId: transfer.toOfficeId, receivedAt: now },
      reason: 'Arrival confirmed at destination office',
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
