import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type PhysicalInventoryScanResult } from '@prisma/client';
import type { AuthUser, SyncBatchInput } from '@techpioasset/contracts';
import {
  orderOperationsForReplay,
  decideOperation,
  type OfflineOperation,
  type OperationResult,
  type SyncResponse,
} from '@techpioasset/domain';
import { tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Applies a batch of queued offline operations (spec section 16).
 *
 * The decision for each operation comes from the pure `decideOperation` in
 * packages/domain; this service supplies the server state it needs and performs
 * the write when the decision is APPLIED. Idempotency is real, not hopeful: the
 * clientGeneratedId is a unique column, so replaying a batch produces DUPLICATE
 * outcomes and zero extra rows.
 */
@Injectable()
export class MobileSyncService {
  private readonly logger = new Logger(MobileSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sync(actor: AuthUser, input: SyncBatchInput): Promise<SyncResponse> {
    const ordered = orderOperationsForReplay(
      input.operations as OfflineOperation<Record<string, unknown>>[],
    );

    const results: OperationResult[] = [];
    for (const op of ordered) {
      results.push(await this.applyOne(actor, op, input.sessionId));
    }

    // scannedCount reflects reality after the batch, for the session summary.
    if (input.sessionId) {
      const scanned = await this.prisma.client.physicalInventoryScan.count({
        where: { sessionId: input.sessionId },
      });
      await this.prisma.client.physicalInventorySession.updateMany({
        where: { id: input.sessionId, ...tenantFilter(actor) },
        data: { scannedCount: scanned },
      });
    }

    return { results, syncedAt: new Date().toISOString() };
  }

  private async applyOne(
    actor: AuthUser,
    op: OfflineOperation<Record<string, unknown>>,
    sessionId?: string,
  ): Promise<OperationResult> {
    // Server state for the decision. The idempotency check is a lookup on the
    // unique clientGeneratedId across the tables that carry it.
    const existingScan =
      op.type === 'INVENTORY_SCAN'
        ? await this.prisma.client.physicalInventoryScan.findUnique({
            where: { clientGeneratedId: op.clientGeneratedId },
            select: { id: true },
          })
        : null;

    const entity =
      op.entityId !== null
        ? await this.prisma.client.asset.findFirst({
            where: { id: op.entityId, ...tenantFilter(actor) },
            select: { id: true, version: true },
          })
        : null;

    const decision = decideOperation(op, {
      alreadyApplied: existingScan !== null,
      existingServerId: existingScan?.id,
      currentVersion: entity?.version,
      entityExists: op.entityId === null || entity !== null,
    });

    if (decision.outcome !== 'APPLIED') return decision;

    try {
      const serverId = await this.persist(actor, op, sessionId);
      return { ...decision, serverId };
    } catch (error) {
      // A late unique-constraint clash (two devices, same id, racing) collapses
      // to DUPLICATE rather than failing the whole batch.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { clientGeneratedId: op.clientGeneratedId, outcome: 'DUPLICATE' };
      }
      this.logger.error(
        `Failed to apply ${op.type} ${op.clientGeneratedId}: ${(error as Error).message}`,
      );
      return {
        clientGeneratedId: op.clientGeneratedId,
        outcome: 'REJECTED',
        message: 'The server could not apply this change.',
      };
    }
  }

  private async persist(
    actor: AuthUser,
    op: OfflineOperation<Record<string, unknown>>,
    sessionId?: string,
  ): Promise<string | undefined> {
    switch (op.type) {
      case 'INVENTORY_SCAN': {
        if (!sessionId) throw new Error('INVENTORY_SCAN requires a sessionId');
        const scannedCode = String(op.payload.scannedCode ?? op.payload.code ?? '');
        // Classify the scan against the register, so the reconciliation report
        // can show expected vs unexpected vs unknown.
        const asset = op.entityId
          ? await this.prisma.client.asset.findFirst({
              where: { id: op.entityId, ...tenantFilter(actor) },
              select: { id: true, roomId: true },
            })
          : await this.prisma.client.asset.findFirst({
              where: {
                OR: [{ qrToken: scannedCode }, { barcode: scannedCode }],
                ...tenantFilter(actor),
              },
              select: { id: true, roomId: true },
            });

        const foundRoomId = op.payload.foundRoomId ? String(op.payload.foundRoomId) : null;
        const result: PhysicalInventoryScanResult = !asset
          ? 'NOT_IN_REGISTER'
          : foundRoomId && asset.roomId && foundRoomId !== asset.roomId
            ? 'UNEXPECTED_LOCATION'
            : 'EXPECTED';

        const scan = await this.prisma.client.physicalInventoryScan.create({
          data: {
            sessionId,
            assetId: asset?.id ?? null,
            scannedCode,
            result,
            foundRoomId,
            condition: op.payload.condition ? (op.payload.condition as never) : null,
            note: op.payload.note ? String(op.payload.note) : null,
            clientGeneratedId: op.clientGeneratedId,
            scannedAt: new Date(op.capturedAt),
            scannedById: actor.id,
          },
        });
        return scan.id;
      }

      case 'CONDITION_UPDATE': {
        if (!op.entityId) throw new Error('CONDITION_UPDATE requires an entityId');
        await this.prisma.client.asset.update({
          where: { id: op.entityId },
          data: {
            condition: op.payload.condition as never,
            updatedById: actor.id,
            version: { increment: 1 },
          },
        });
        await this.prisma.client.assetConditionLog.create({
          data: {
            assetId: op.entityId,
            newCondition: op.payload.condition as never,
            reason: 'Mobile offline update',
            createdById: actor.id,
          },
        });
        return op.entityId;
      }

      case 'LOCATION_UPDATE': {
        if (!op.entityId) throw new Error('LOCATION_UPDATE requires an entityId');
        await this.prisma.client.asset.update({
          where: { id: op.entityId },
          data: {
            roomId: op.payload.roomId ? String(op.payload.roomId) : null,
            updatedById: actor.id,
            version: { increment: 1 },
          },
        });
        return op.entityId;
      }

      case 'NOTE': {
        if (!op.entityId) return undefined;
        await this.prisma.client.asset.update({
          where: { id: op.entityId },
          data: {
            notes: String(op.payload.note ?? ''),
            updatedById: actor.id,
            version: { increment: 1 },
          },
        });
        return op.entityId;
      }

      case 'ASSET_PHOTO':
        // The photo bytes upload through the storage route separately; the queued
        // op only records the intent, which is a no-op server-side here.
        return op.entityId ?? undefined;

      default:
        return undefined;
    }
  }
}
