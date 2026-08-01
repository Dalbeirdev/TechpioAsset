import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AuthUser,
  ConvertPurchaseRequestInput,
  CreatePurchaseRequestInput,
  DecidePurchaseRequestInput,
  PrListQuery,
  ReceiveGrnInput,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  canApprovePurchaseRequest,
  canTransitionPurchaseRequest,
  needsFinanceApproval,
  overReceiptMessage,
  rollupPurchaseOrderStatus,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { AuditService } from '../audit/audit.service.js';
import { AppConfig } from '../config/config.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SORTABLE = ['createdAt', 'prNumber', 'status'] as const;

/**
 * v2.4 Procurement: PR lifecycle -> PO -> GRN. The over-receipt guard is the
 * seat-pool pattern applied to purchase-order lines: an atomic conditional
 * increment of receivedQuantity whose WHERE clause is the hard limit, backed by
 * the DB CHECK. Receipts are append-only facts.
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  // ── purchase requests ──────────────────────────────────────────────────────

  async listPrs(actor: AuthUser, query: PrListQuery) {
    const where: Prisma.PurchaseRequestWhereInput = {
      companyId: actor.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.mine ? { requesterId: actor.id } : {}),
      ...(query.q ? { OR: [{ prNumber: { contains: query.q, mode: 'insensitive' } }, { justification: { contains: query.q, mode: 'insensitive' } }] } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.client.purchaseRequest.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.purchaseRequest.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: this.prSelect(),
        }),
    });
  }

  async findPr(actor: AuthUser, id: string) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      where: { id, companyId: actor.companyId },
      select: { ...this.prSelect(), lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, description: true, quantity: true, estimatedUnitPrice: true, inventoryItemId: true } } },
    });
    if (!pr) throw AppError.notFound('Purchase request', id);
    return pr;
  }

  async createPr(actor: AuthUser, input: CreatePurchaseRequestInput) {
    const estimatedTotal = input.lines.reduce(
      (sum, l) => sum + (l.estimatedUnitPrice ? Number(l.estimatedUnitPrice) * l.quantity : 0),
      0,
    );
    const pr = await this.prisma.client.purchaseRequest.create({
      data: {
        companyId: actor.companyId,
        prNumber: await this.nextNumber('purchaseRequest', 'PR'),
        requesterId: actor.id,
        justification: input.justification,
        neededBy: input.neededBy ?? null,
        currency: input.currency ?? null,
        estimatedTotal: estimatedTotal > 0 ? new Prisma.Decimal(estimatedTotal.toFixed(2)) : null,
        createdById: actor.id,
        updatedById: actor.id,
        lines: {
          create: input.lines.map((l, i) => ({
            lineNumber: i + 1,
            description: l.description,
            quantity: new Prisma.Decimal(l.quantity),
            estimatedUnitPrice: l.estimatedUnitPrice ? new Prisma.Decimal(l.estimatedUnitPrice) : null,
            inventoryItemId: l.inventoryItemId ?? null,
          })),
        },
      },
      select: { id: true },
    });
    return this.findPr(actor, pr.id);
  }

  async submitPr(actor: AuthUser, id: string) {
    const pr = await this.loadPr(actor, id);
    // Only the requester progresses their own draft.
    if (pr.requesterId !== actor.id) throw AppError.forbidden('Only the requester can submit this PR');
    this.assertTransition(pr.status, 'SUBMITTED');
    await this.prisma.client.purchaseRequest.update({
      where: { id },
      data: { status: 'SUBMITTED', submittedAt: new Date(), updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.PR_SUBMITTED,
      entityType: 'PurchaseRequest',
      entityId: id,
    });
    return this.findPr(actor, id);
  }

  async decidePr(actor: AuthUser, id: string, input: DecidePurchaseRequestInput) {
    const pr = await this.loadPr(actor, id);
    // SoD: the requester never approves their own purchase (hard block).
    if (!canApprovePurchaseRequest(actor.id, pr.requesterId)) {
      throw AppError.forbidden('You cannot decide your own purchase request');
    }
    const target = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    this.assertTransition(pr.status, target);

    // Above the Finance threshold the approver must also hold the cost
    // permission (the standing Finance + Super Admin rule).
    if (
      input.decision === 'APPROVE' &&
      needsFinanceApproval(pr.estimatedTotal?.toString() ?? null, this.config.get('PR_FINANCE_THRESHOLD')) &&
      !actor.permissions.includes(PERMISSIONS.ASSETS_COST_READ)
    ) {
      throw AppError.forbidden(
        'This request is at or above the Finance threshold - a Finance approver must decide it',
      );
    }

    await this.prisma.client.purchaseRequest.update({
      where: { id },
      data: {
        status: target,
        ...(target === 'APPROVED'
          ? { approvedById: actor.id, approvedAt: new Date() }
          : { rejectedReason: input.reason ?? null }),
        updatedById: actor.id,
      },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: target === 'APPROVED' ? AuditAction.PR_APPROVED : AuditAction.PR_REJECTED,
      entityType: 'PurchaseRequest',
      entityId: id,
      reason: input.reason ?? undefined,
    });
    return this.findPr(actor, id);
  }

  /** APPROVED -> CONVERTED: spawns a draft PO carrying the PR's lines. */
  async convertPr(actor: AuthUser, id: string, input: ConvertPurchaseRequestInput) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, status: true, currency: true, requesterId: true, lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!pr) throw AppError.notFound('Purchase request', id);
    this.assertTransition(pr.status, 'CONVERTED');
    const vendor = await this.prisma.client.vendor.findFirst({
      where: { id: input.vendorId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) throw AppError.notFound('Vendor', input.vendorId);

    const currency = input.currency ?? pr.currency ?? 'USD';
    const subtotal = pr.lines.reduce(
      (sum, l) => sum + Number(l.estimatedUnitPrice ?? 0) * Number(l.quantity),
      0,
    );

    const po = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          companyId: actor.companyId,
          poNumber: await this.nextNumber('purchaseOrder', 'PO'),
          vendorId: vendor.id,
          currency,
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          total: new Prisma.Decimal(subtotal.toFixed(2)),
          createdById: actor.id,
          updatedById: actor.id,
          lines: {
            create: pr.lines.map((l) => ({
              lineNumber: l.lineNumber,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.estimatedUnitPrice ?? new Prisma.Decimal(0),
              lineTotal: new Prisma.Decimal(
                (Number(l.estimatedUnitPrice ?? 0) * Number(l.quantity)).toFixed(2),
              ),
            })),
          },
        },
        select: { id: true, poNumber: true },
      });
      await tx.purchaseRequest.update({
        where: { id },
        data: { status: 'CONVERTED', convertedPoId: created.id, updatedById: actor.id },
      });
      return created;
    });

    return { purchaseRequestId: id, purchaseOrderId: po.id, poNumber: po.poNumber };
  }

  // ── purchase orders ────────────────────────────────────────────────────────

  async issuePo(actor: AuthUser, id: string) {
    const po = await this.loadPo(actor, id);
    if (po.status !== 'DRAFT') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `Only a draft PO can be issued (this one is ${po.status})`);
    }
    if (po.lines.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Add at least one line before issuing');
    }
    await this.prisma.client.purchaseOrder.update({
      where: { id },
      data: { status: 'ISSUED', issuedDate: new Date(), updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.PO_ISSUED,
      entityType: 'PurchaseOrder',
      entityId: id,
    });
    // The requester whose PR became this PO hears their order went out.
    const sourcePr = await this.prisma.client.purchaseRequest.findFirst({
      where: { convertedPoId: id },
      select: { requesterId: true },
    });
    if (sourcePr) {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: sourcePr.requesterId,
        type: 'ASSET_ORDERED',
        title: `Ordered: ${po.poNumber}`,
        body: 'Your approved purchase request has been ordered from the vendor.',
        linkPath: `/procurement/orders/${id}`,
        entityType: 'PurchaseOrder',
        entityId: id,
      });
    }
    return this.loadPo(actor, id);
  }

  async cancelPo(actor: AuthUser, id: string, reason?: string | null) {
    const po = await this.loadPo(actor, id);
    if (po.status !== 'DRAFT' && po.status !== 'ISSUED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${po.status} PO cannot be cancelled`);
    }
    const receipts = await this.prisma.client.goodsReceipt.count({ where: { purchaseOrderId: id } });
    if (receipts > 0) {
      throw AppError.conflict('CONFLICT', 'Goods were already received against this PO - close it instead');
    }
    await this.prisma.client.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.PO_CANCELLED,
      entityType: 'PurchaseOrder',
      entityId: id,
      reason: reason ?? undefined,
    });
    return this.loadPo(actor, id);
  }

  // ── goods receipts (the guarded intake) ────────────────────────────────────

  async receive(actor: AuthUser, purchaseOrderId: string, input: ReceiveGrnInput) {
    const po = await this.loadPo(actor, purchaseOrderId);
    if (po.status !== 'ISSUED' && po.status !== 'PARTIALLY_RECEIVED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${po.status} PO cannot receive goods`);
    }
    const lineById = new Map(po.lines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      const poLine = lineById.get(line.purchaseOrderLineId);
      if (!poLine) throw AppError.notFound('PO line', line.purchaseOrderLineId);
      if (line.intake === 'STOCK' && (!line.stockLocationId || !line.inventoryItemId)) {
        throw new AppError('VALIDATION_FAILED', 'STOCK intake needs a location and an inventory item');
      }
    }
    // Validate stock refs inside the tenant before mutating anything.
    for (const line of input.lines.filter((l) => l.intake === 'STOCK')) {
      const [location, item] = await Promise.all([
        this.prisma.client.stockLocation.findFirst({
          where: { id: line.stockLocationId!, companyId: actor.companyId, deletedAt: null },
          select: { id: true },
        }),
        this.prisma.client.inventoryItem.findFirst({
          where: { id: line.inventoryItemId!, companyId: actor.companyId, deletedAt: null },
          select: { id: true },
        }),
      ]);
      if (!location) throw AppError.notFound('Stock location', line.stockLocationId!);
      if (!item) throw AppError.notFound('Inventory item', line.inventoryItemId!);
    }

    // Concurrent receivers can race the sequential GRN number; the unique
    // constraint catches the loser, and we retry the whole (rolled-back)
    // transaction with a fresh number rather than surfacing a 500.
    const grn = await this.withGrnNumberRetry(async (grnNumber) =>
      this.prisma.client.$transaction(async (tx) => {
      // 1. Guarded increments - the WHERE clause is the over-receipt limit.
      for (const line of input.lines) {
        const poLine = lineById.get(line.purchaseOrderLineId)!;
        const affected = await tx.$executeRaw`
          UPDATE "purchase_order_lines"
             SET "receivedQuantity" = "receivedQuantity" + ${new Prisma.Decimal(line.quantity)}
           WHERE "id" = ${line.purchaseOrderLineId}
             AND "receivedQuantity" + ${new Prisma.Decimal(line.quantity)} <= "quantity"`;
        if (affected === 0) {
          throw AppError.conflict(
            'CONFLICT',
            overReceiptMessage(
              { quantity: poLine.quantity.toString(), receivedQuantity: poLine.receivedQuantity.toString() },
              line.quantity,
            ),
          );
        }
      }

      // 2. The receipt itself - an append-only fact.
      const created = await tx.goodsReceipt.create({
        data: {
          companyId: actor.companyId,
          grnNumber,
          purchaseOrderId,
          receivedById: actor.id,
          notes: input.notes ?? null,
          lines: {
            create: input.lines.map((l) => ({
              purchaseOrderLineId: l.purchaseOrderLineId,
              quantity: new Prisma.Decimal(l.quantity),
              intake: l.intake,
              stockLocationId: l.stockLocationId ?? null,
              inventoryItemId: l.inventoryItemId ?? null,
              note: l.note ?? null,
            })),
          },
        },
        select: { id: true, grnNumber: true, lines: { select: { id: true, intake: true, quantity: true, stockLocationId: true, inventoryItemId: true } } },
      });

      // 3. STOCK intake posts to the ledger and bumps the caches.
      for (const grnLine of created.lines) {
        if (grnLine.intake !== 'STOCK') continue;
        await tx.stockMovement.create({
          data: {
            companyId: actor.companyId,
            inventoryItemId: grnLine.inventoryItemId!,
            stockLocationId: grnLine.stockLocationId!,
            type: 'RECEIPT',
            quantity: grnLine.quantity,
            refType: 'GoodsReceiptLine',
            refId: grnLine.id,
            actorId: actor.id,
          },
        });
        await tx.stockLevel.upsert({
          where: {
            inventoryItemId_stockLocationId: {
              inventoryItemId: grnLine.inventoryItemId!,
              stockLocationId: grnLine.stockLocationId!,
            },
          },
          create: {
            companyId: actor.companyId,
            inventoryItemId: grnLine.inventoryItemId!,
            stockLocationId: grnLine.stockLocationId!,
            quantity: grnLine.quantity,
          },
          update: { quantity: { increment: grnLine.quantity } },
        });
        await tx.inventoryItem.update({
          where: { id: grnLine.inventoryItemId! },
          data: { quantityOnHand: { increment: grnLine.quantity }, lastPurchaseDate: new Date() },
        });
      }

      // 4. The PO status its lines now imply.
      const lines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId },
        select: { quantity: true, receivedQuantity: true },
      });
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: rollupPurchaseOrderStatus(
            lines.map((l) => ({ quantity: l.quantity.toString(), receivedQuantity: l.receivedQuantity.toString() })),
          ),
          updatedById: actor.id,
        },
      });
        return created;
      }),
    );

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.GRN_RECEIVED,
      entityType: 'PurchaseOrder',
      entityId: purchaseOrderId,
      newValues: { grnNumber: grn.grnNumber, lines: input.lines.length },
    });
    if (po.createdById && po.createdById !== actor.id) {
      await this.notifications.notify({
        companyId: actor.companyId,
        userId: po.createdById,
        type: 'ASSET_RECEIVED',
        title: `Goods received: ${grn.grnNumber}`,
        body: `${input.lines.length} line(s) received against ${po.poNumber}.`,
        linkPath: `/procurement/orders/${purchaseOrderId}`,
        entityType: 'PurchaseOrder',
        entityId: purchaseOrderId,
      });
    }
    return this.loadPo(actor, purchaseOrderId);
  }

  async listPos(actor: AuthUser, query: PrListQuery) {
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: actor.companyId,
      ...(query.q ? { poNumber: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.client.purchaseOrder.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.purchaseOrder.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            poNumber: true,
            status: true,
            issuedDate: true,
            currency: true,
            total: true,
            vendor: { select: { id: true, name: true } },
            _count: { select: { receipts: true } },
          },
        }),
    });
  }

  async findPo(actor: AuthUser, id: string) {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        poNumber: true,
        status: true,
        issuedDate: true,
        expectedDate: true,
        currency: true,
        subtotal: true,
        total: true,
        notes: true,
        vendor: { select: { id: true, name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          select: { id: true, lineNumber: true, description: true, quantity: true, unitPrice: true, lineTotal: true, receivedQuantity: true },
        },
        receipts: {
          orderBy: { receivedAt: 'desc' },
          select: {
            id: true,
            grnNumber: true,
            receivedAt: true,
            receivedById: true,
            notes: true,
            lines: { select: { id: true, purchaseOrderLineId: true, quantity: true, intake: true } },
          },
        },
      },
    });
    if (!po) throw AppError.notFound('Purchase order', id);
    return po;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private assertTransition(from: string, to: string) {
    if (!canTransitionPurchaseRequest(from as never, to as never)) {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${from} purchase request cannot become ${to}`);
    }
  }

  private async loadPr(actor: AuthUser, id: string) {
    const pr = await this.prisma.client.purchaseRequest.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, status: true, requesterId: true, estimatedTotal: true },
    });
    if (!pr) throw AppError.notFound('Purchase request', id);
    return pr;
  }

  private async loadPo(actor: AuthUser, id: string) {
    const po = await this.prisma.client.purchaseOrder.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        id: true,
        poNumber: true,
        status: true,
        createdById: true,
        lines: { select: { id: true, quantity: true, receivedQuantity: true } },
      },
    });
    if (!po) throw AppError.notFound('Purchase order', id);
    return po;
  }

  private prSelect() {
    return {
      id: true,
      prNumber: true,
      status: true,
      justification: true,
      estimatedTotal: true,
      currency: true,
      neededBy: true,
      submittedAt: true,
      approvedAt: true,
      rejectedReason: true,
      convertedPoId: true,
      createdAt: true,
      requester: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
    } satisfies Prisma.PurchaseRequestSelect;
  }

  /** Retries a GRN-numbered operation when the sequential number collides. */
  private async withGrnNumberRetry<T>(fn: (grnNumber: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const grnNumber = await this.nextNumber('goodsReceipt', 'GRN');
      try {
        return await fn(grnNumber);
      } catch (error) {
        const unique =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!unique || attempt >= 4) throw error;
      }
    }
  }

  /** `PR-2026-000042`-style numbers, per entity, unique per company. */
  private async nextNumber(
    entity: 'purchaseRequest' | 'purchaseOrder' | 'goodsReceipt',
    prefix: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const full = `${prefix}-${year}-`;
    const field = entity === 'purchaseRequest' ? 'prNumber' : entity === 'purchaseOrder' ? 'poNumber' : 'grnNumber';
    const client = this.prisma.client[entity] as unknown as {
      findFirst: (args: object) => Promise<Record<string, string> | null>;
    };
    const latest = await client.findFirst({
      where: { [field]: { startsWith: full } },
      orderBy: { [field]: 'desc' },
      select: { [field]: true },
    });
    const next = latest ? Number(latest[field]!.slice(full.length)) + 1 : 1;
    return `${full}${String(next).padStart(6, '0')}`;
  }
}
