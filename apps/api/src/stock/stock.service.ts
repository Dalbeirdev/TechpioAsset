import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import type {
  AdjustStockInput,
  AuthUser,
  ConvertToAssetInput,
  CountCorrectionInput,
  CreateStockLocationInput,
  IssueStockInput,
  ReserveStockInput,
  StockMovementQuery,
  TransferStockInput,
  UpdateStockLocationInput,
} from '@techpioasset/contracts';
import { insufficientStockMessage, isLowStock } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { paginate } from '../common/paginate.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The client shape Prisma passes to interactive-transaction callbacks. */
type Tx = Omit<
  PrismaService['client'],
  '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'
>;

/**
 * v2.4 Warehouse stock. The append-only stock_movements ledger is the truth;
 * StockLevel rows are cached rollups changed ONLY through atomic conditional
 * updates whose WHERE clauses are the guards (never below reservations, never
 * negative), with the DB CHECKs as the last line of defence. Every mutation
 * posts its movement row in the same transaction.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── locations ──────────────────────────────────────────────────────────────

  async listLocations(actor: AuthUser) {
    return this.prisma.client.stockLocation.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        officeId: true,
        isActive: true,
        _count: { select: { levels: true } },
      },
    });
  }

  async createLocation(actor: AuthUser, input: CreateStockLocationInput) {
    if (input.officeId) {
      const office = await this.prisma.client.office.findFirst({
        where: { id: input.officeId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!office) throw AppError.notFound('Office', input.officeId);
    }
    try {
      return await this.prisma.client.stockLocation.create({
        data: {
          companyId: actor.companyId,
          code: input.code,
          name: input.name,
          officeId: input.officeId ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppError.conflict('CONFLICT', `A location with code ${input.code} already exists`);
      }
      throw error;
    }
  }

  async updateLocation(actor: AuthUser, id: string, input: UpdateStockLocationInput) {
    const location = await this.prisma.client.stockLocation.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!location) throw AppError.notFound('Stock location', id);
    return this.prisma.client.stockLocation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.officeId !== undefined ? { officeId: input.officeId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedById: actor.id,
      },
    });
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** The tenant's stock-item catalogue (for intake and adjustment pickers). */
  async listItems(actor: AuthUser) {
    return this.prisma.client.inventoryItem.findMany({
      where: { companyId: actor.companyId, deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, sku: true, name: true, unit: true, minStock: true, quantityOnHand: true },
    });
  }

  async listLevels(actor: AuthUser, inventoryItemId?: string, stockLocationId?: string) {
    return this.prisma.client.stockLevel.findMany({
      where: {
        companyId: actor.companyId,
        ...(inventoryItemId ? { inventoryItemId } : {}),
        ...(stockLocationId ? { stockLocationId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        quantity: true,
        reserved: true,
        updatedAt: true,
        inventoryItem: { select: { id: true, sku: true, name: true, unit: true, minStock: true } },
        stockLocation: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async listMovements(actor: AuthUser, query: StockMovementQuery) {
    const where: Prisma.StockMovementWhereInput = {
      companyId: actor.companyId,
      ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
      ...(query.stockLocationId ? { stockLocationId: query.stockLocationId } : {}),
    };
    return paginate(query, {
      count: () => this.prisma.client.stockMovement.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.stockMovement.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            quantity: true,
            refType: true,
            refId: true,
            reason: true,
            actorId: true,
            createdAt: true,
            stockLocationId: true,
            inventoryItem: { select: { id: true, sku: true, name: true } },
          },
        }),
    });
  }

  // ── guarded mutations ──────────────────────────────────────────────────────

  /** Hand stock out (consumables leaving the shelf). */
  async issue(actor: AuthUser, input: IssueStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    await this.takeStock(actor, {
      ...input,
      movementType: 'ISSUE',
      reason: input.reason ?? null,
      refType: null,
      refId: null,
      bumpGlobal: true,
    });
    await this.auditMovement(actor, input.inventoryItemId, 'ISSUE', input.quantity, input.reason);
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /** Manual correction, up or down, always with a reason. */
  async adjust(actor: AuthUser, input: AdjustStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    const quantity = Math.abs(input.delta);
    if (input.delta > 0) {
      await this.addStock(actor, {
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        quantity,
        movementType: 'ADJUST_UP',
        reason: input.reason,
        refType: null,
        refId: null,
        bumpGlobal: true,
      });
    } else {
      await this.takeStock(actor, {
        inventoryItemId: input.inventoryItemId,
        stockLocationId: input.stockLocationId,
        quantity,
        movementType: 'ADJUST_DOWN',
        reason: input.reason,
        refType: null,
        refId: null,
        bumpGlobal: true,
      });
    }
    await this.auditMovement(
      actor,
      input.inventoryItemId,
      input.delta > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
      quantity,
      input.reason,
    );
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /** Move stock between locations: one transaction, two ledger rows. */
  async transfer(actor: AuthUser, input: TransferStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.fromLocationId);
    const to = await this.prisma.client.stockLocation.findFirst({
      where: { id: input.toLocationId, companyId: actor.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!to) throw AppError.notFound('Destination location', input.toLocationId);

    await this.prisma.client.$transaction(async (tx) => {
      await this.guardedTake(tx, actor, input.inventoryItemId, input.fromLocationId, input.quantity);
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.fromLocationId,
          type: 'TRANSFER_OUT',
          quantity: new Prisma.Decimal(input.quantity),
          reason: input.note ?? null,
          actorId: actor.id,
        },
      });
      await this.upsertAdd(tx, actor, input.inventoryItemId, input.toLocationId, input.quantity);
      const transfer = await tx.stockTransfer.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          quantity: new Prisma.Decimal(input.quantity),
          note: input.note ?? null,
          movedById: actor.id,
        },
        select: { id: true },
      });
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.toLocationId,
          type: 'TRANSFER_IN',
          quantity: new Prisma.Decimal(input.quantity),
          refType: 'StockTransfer',
          refId: transfer.id,
          reason: input.note ?? null,
          actorId: actor.id,
        },
      });
    });
    await this.auditMovement(actor, input.inventoryItemId, 'TRANSFER', input.quantity, input.note);
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.fromLocationId);
    return {
      from: await this.levelOf(input.inventoryItemId, input.fromLocationId),
      to: await this.levelOf(input.inventoryItemId, input.toLocationId),
    };
  }

  /** Earmark stock (e.g. for an approved request) without removing it. */
  async reserve(actor: AuthUser, input: ReserveStockInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    const affected = await this.prisma.client.$executeRaw`
      UPDATE "stock_levels"
         SET "reserved" = "reserved" + ${new Prisma.Decimal(input.quantity)}
       WHERE "inventoryItemId" = ${input.inventoryItemId}
         AND "stockLocationId" = ${input.stockLocationId}
         AND "companyId" = ${actor.companyId}
         AND "reserved" + ${new Prisma.Decimal(input.quantity)} <= "quantity"`;
    if (affected === 0) {
      const level = await this.levelOf(input.inventoryItemId, input.stockLocationId);
      throw AppError.conflict(
        'CONFLICT',
        insufficientStockMessage(level?.quantity.toString() ?? 0, level?.reserved.toString() ?? 0, input.quantity),
      );
    }
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  async release(actor: AuthUser, input: ReserveStockInput) {
    const affected = await this.prisma.client.$executeRaw`
      UPDATE "stock_levels"
         SET "reserved" = "reserved" - ${new Prisma.Decimal(input.quantity)}
       WHERE "inventoryItemId" = ${input.inventoryItemId}
         AND "stockLocationId" = ${input.stockLocationId}
         AND "companyId" = ${actor.companyId}
         AND "reserved" - ${new Prisma.Decimal(input.quantity)} >= 0`;
    if (affected === 0) {
      throw AppError.conflict('CONFLICT', 'Cannot release more than is reserved');
    }
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /** A physical count overrides the shelf: post the signed difference. */
  async countCorrection(actor: AuthUser, input: CountCorrectionInput) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    const level = await this.levelOf(input.inventoryItemId, input.stockLocationId);
    const current = Number(level?.quantity ?? 0);
    const delta = input.countedQuantity - current;
    if (delta === 0) return { level, corrected: false as const };

    const shared = {
      inventoryItemId: input.inventoryItemId,
      stockLocationId: input.stockLocationId,
      quantity: Math.abs(delta),
      reason: 'Cycle-count correction',
      refType: 'PhysicalInventorySession',
      refId: input.sessionId ?? null,
      bumpGlobal: true,
    };
    if (delta > 0) await this.addStock(actor, { ...shared, movementType: 'ADJUST_UP' });
    else await this.takeStock(actor, { ...shared, movementType: 'ADJUST_DOWN' });

    await this.auditMovement(
      actor,
      input.inventoryItemId,
      delta > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN',
      Math.abs(delta),
      `Cycle count: shelf said ${input.countedQuantity}, system said ${current}`,
    );
    return { level: await this.levelOf(input.inventoryItemId, input.stockLocationId), corrected: true as const };
  }

  /**
   * One unit of stock becomes a tracked asset — decrement and draft creation
   * in a single transaction, so the unit exists exactly once at all times.
   */
  async convertToAsset(actor: AuthUser, input: ConvertToAssetInput) {
    const item = await this.prisma.client.inventoryItem.findFirst({
      where: { id: input.inventoryItemId, companyId: actor.companyId, deletedAt: null },
      select: { id: true, name: true, categoryId: true, subcategoryId: true, unitCost: true, currency: true },
    });
    if (!item) throw AppError.notFound('Inventory item', input.inventoryItemId);
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);

    const asset = await this.prisma.client.$transaction(async (tx) => {
      await this.guardedTake(tx, actor, input.inventoryItemId, input.stockLocationId, 1);
      const created = await tx.asset.create({
        data: {
          companyId: actor.companyId,
          assetTag: input.assetTag,
          name: input.name ?? item.name,
          categoryId: item.categoryId,
          subcategoryId: item.subcategoryId,
          trackingType: 'INDIVIDUAL',
          serialNumber: input.serialNumber ?? null,
          qrToken: ulid(),
          purchaseCost: null,
          currency: item.currency ?? null,
          notes: input.notes ?? `Converted from stock item ${item.name}`,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true, assetTag: true, name: true, status: true },
      });
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
          type: 'CONVERT_TO_ASSET',
          quantity: new Prisma.Decimal(1),
          refType: 'Asset',
          refId: created.id,
          actorId: actor.id,
        },
      });
      await tx.inventoryItem.update({
        where: { id: input.inventoryItemId },
        data: { quantityOnHand: { decrement: 1 } },
      });
      return created;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_CREATED,
      entityType: 'Asset',
      entityId: asset.id,
      newValues: { assetTag: asset.assetTag, convertedFrom: input.inventoryItemId },
      reason: 'Converted from stock',
    });
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return { asset, level: await this.levelOf(input.inventoryItemId, input.stockLocationId) };
  }

  /**
   * v2.5 H3 — draw a part for a work order. The exact same guarded take and
   * ledger discipline as issue(), but the movement row carries the work-order
   * reference so the record shows what was used to fix what.
   */
  async consumeForWorkOrder(
    actor: AuthUser,
    input: {
      inventoryItemId: string;
      stockLocationId: string;
      quantity: number;
      workOrderId: string;
      note?: string | null;
    },
  ) {
    await this.assertRefs(actor, input.inventoryItemId, input.stockLocationId);
    await this.takeStock(actor, {
      inventoryItemId: input.inventoryItemId,
      stockLocationId: input.stockLocationId,
      quantity: input.quantity,
      movementType: 'ISSUE',
      reason: input.note ?? null,
      refType: 'MaintenanceRecord',
      refId: input.workOrderId,
      bumpGlobal: true,
    });
    await this.auditMovement(
      actor,
      input.inventoryItemId,
      'WORK_ORDER_PART',
      input.quantity,
      input.note,
    );
    await this.maybeLowStockAlert(actor, input.inventoryItemId, input.stockLocationId);
    return this.levelOf(input.inventoryItemId, input.stockLocationId);
  }

  /** The parts drawn against one work order, newest first. */
  async partsForWorkOrder(companyId: string, workOrderId: string) {
    return this.prisma.client.stockMovement.findMany({
      where: { companyId, refType: 'MaintenanceRecord', refId: workOrderId, type: 'ISSUE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        quantity: true,
        reason: true,
        createdAt: true,
        actorId: true,
        inventoryItem: { select: { id: true, sku: true, name: true, unit: true } },
      },
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async assertRefs(actor: AuthUser, inventoryItemId: string, stockLocationId: string) {
    const [item, location] = await Promise.all([
      this.prisma.client.inventoryItem.findFirst({
        where: { id: inventoryItemId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.client.stockLocation.findFirst({
        where: { id: stockLocationId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (!item) throw AppError.notFound('Inventory item', inventoryItemId);
    if (!location) throw AppError.notFound('Stock location', stockLocationId);
  }

  private levelOf(inventoryItemId: string, stockLocationId: string) {
    return this.prisma.client.stockLevel.findUnique({
      where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId } },
      select: { id: true, quantity: true, reserved: true },
    });
  }

  /** Conditional decrement — the WHERE clause keeps quantity >= reserved. */
  private async guardedTake(
    tx: Tx,
    actor: AuthUser,
    inventoryItemId: string,
    stockLocationId: string,
    quantity: number,
  ) {
    const affected = await tx.$executeRaw`
      UPDATE "stock_levels"
         SET "quantity" = "quantity" - ${new Prisma.Decimal(quantity)}
       WHERE "inventoryItemId" = ${inventoryItemId}
         AND "stockLocationId" = ${stockLocationId}
         AND "companyId" = ${actor.companyId}
         AND "quantity" - ${new Prisma.Decimal(quantity)} >= "reserved"`;
    if (affected === 0) {
      const level = await this.levelOf(inventoryItemId, stockLocationId);
      throw AppError.conflict(
        'CONFLICT',
        insufficientStockMessage(level?.quantity.toString() ?? 0, level?.reserved.toString() ?? 0, quantity),
      );
    }
  }

  private async upsertAdd(
    tx: Tx,
    actor: AuthUser,
    inventoryItemId: string,
    stockLocationId: string,
    quantity: number,
  ) {
    await tx.stockLevel.upsert({
      where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId } },
      create: {
        companyId: actor.companyId,
        inventoryItemId,
        stockLocationId,
        quantity: new Prisma.Decimal(quantity),
      },
      update: { quantity: { increment: new Prisma.Decimal(quantity) } },
    });
  }

  private async addStock(
    actor: AuthUser,
    input: {
      inventoryItemId: string;
      stockLocationId: string;
      quantity: number;
      movementType: 'ADJUST_UP';
      reason: string | null;
      refType: string | null;
      refId: string | null;
      bumpGlobal: boolean;
    },
  ) {
    await this.prisma.client.$transaction(async (tx) => {
      await this.upsertAdd(tx, actor, input.inventoryItemId, input.stockLocationId, input.quantity);
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
          type: input.movementType,
          quantity: new Prisma.Decimal(input.quantity),
          refType: input.refType,
          refId: input.refId,
          reason: input.reason,
          actorId: actor.id,
        },
      });
      if (input.bumpGlobal) {
        await tx.inventoryItem.update({
          where: { id: input.inventoryItemId },
          data: { quantityOnHand: { increment: input.quantity } },
        });
      }
    });
  }

  private async takeStock(
    actor: AuthUser,
    input: {
      inventoryItemId: string;
      stockLocationId: string;
      quantity: number;
      movementType: 'ISSUE' | 'ADJUST_DOWN';
      reason: string | null;
      refType: string | null;
      refId: string | null;
      bumpGlobal: boolean;
    },
  ) {
    await this.prisma.client.$transaction(async (tx) => {
      await this.guardedTake(tx, actor, input.inventoryItemId, input.stockLocationId, input.quantity);
      await tx.stockMovement.create({
        data: {
          companyId: actor.companyId,
          inventoryItemId: input.inventoryItemId,
          stockLocationId: input.stockLocationId,
          type: input.movementType,
          quantity: new Prisma.Decimal(input.quantity),
          refType: input.refType,
          refId: input.refId,
          reason: input.reason,
          actorId: actor.id,
        },
      });
      if (input.bumpGlobal) {
        await tx.inventoryItem.update({
          where: { id: input.inventoryItemId },
          data: { quantityOnHand: { decrement: input.quantity } },
        });
      }
    });
  }

  private async auditMovement(
    actor: AuthUser,
    inventoryItemId: string,
    kind: string,
    quantity: number,
    reason?: string | null,
  ) {
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.INVENTORY_ADJUSTED,
      entityType: 'InventoryItem',
      entityId: inventoryItemId,
      newValues: { kind, quantity },
      reason: reason ?? undefined,
    });
  }

  /** LOW_STOCK once per (level, day) when the location drops to the minimum. */
  private async maybeLowStockAlert(actor: AuthUser, inventoryItemId: string, stockLocationId: string) {
    const level = await this.prisma.client.stockLevel.findUnique({
      where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId } },
      select: {
        id: true,
        quantity: true,
        inventoryItem: { select: { name: true, minStock: true, createdById: true } },
        stockLocation: { select: { name: true } },
      },
    });
    if (!level || !isLowStock(level.quantity.toString(), level.inventoryItem.minStock?.toString())) return;
    const recipientId = level.inventoryItem.createdById;
    if (!recipientId) return;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const already = await this.prisma.client.notification.findFirst({
      where: { entityId: level.id, type: 'LOW_STOCK', createdAt: { gte: startOfDay } },
      select: { id: true },
    });
    if (already) return;

    await this.notifications.notify({
      companyId: actor.companyId,
      userId: recipientId,
      type: 'LOW_STOCK',
      title: `Low stock: ${level.inventoryItem.name}`,
      body: `${level.stockLocation.name} is down to ${Number(level.quantity)} (minimum ${Number(level.inventoryItem.minStock)}).`,
      linkPath: `/inventory`,
      entityType: 'StockLevel',
      entityId: level.id,
    });
  }
}
