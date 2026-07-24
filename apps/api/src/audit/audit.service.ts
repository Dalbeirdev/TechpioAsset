import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import type { AuditQuery, AuthUser } from '@techpioasset/contracts';
import { getRequestContext } from '../common/request-context.js';
import { paginate } from '../common/paginate.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  companyId: string;
  actorId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  previousValues?: Prisma.InputJsonValue | null;
  newValues?: Prisma.InputJsonValue | null;
  reason?: string;
}

/**
 * Append-only audit trail (spec section 21).
 *
 * There is deliberately no update or delete method here, and `AuditLog` is in the
 * ORM's undeletable set - the record is written once and never revised.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records an entry, taking actor, IP, user agent and correlation ID from the
   * ambient request context so callers cannot forget them.
   *
   * A failure here is logged at error level but does not propagate. The
   * alternative - failing the request - would mean a full audit table could lock
   * users out of logging in, and a transient write failure would roll back
   * business operations that legitimately succeeded. The trade is deliberate:
   * gaps are made loud rather than allowed to take the system down.
   */
  async record(entry: AuditEntry): Promise<void> {
    const ctx = getRequestContext();
    try {
      await this.prisma.client.auditLog.create({
        data: {
          companyId: entry.companyId,
          actorId: entry.actorId ?? ctx?.userId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          previousValues: entry.previousValues ?? undefined,
          newValues: entry.newValues ?? undefined,
          reason: entry.reason,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          clientType: ctx?.clientType,
          correlationId: ctx?.correlationId,
        },
      });
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED action=${entry.action} entity=${entry.entityType}:${entry.entityId} ` +
          `actor=${entry.actorId ?? ctx?.userId ?? 'unknown'} correlation=${ctx?.correlationId ?? 'none'}: ` +
          (error as Error).message,
      );
    }
  }

  /**
   * Diffs two records and logs only the changed fields.
   *
   * Storing whole rows would copy password hashes and MFA secrets into a table
   * that many roles can read, so the caller passes an explicit field list and
   * sensitive columns never appear.
   */
  async recordChange<T extends Record<string, unknown>>(
    entry: Omit<AuditEntry, 'previousValues' | 'newValues'>,
    before: T,
    after: T,
    fields: readonly (keyof T)[],
  ): Promise<void> {
    const previousValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const field of fields) {
      const from = before[field];
      const to = after[field];
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        previousValues[field as string] = from ?? null;
        newValues[field as string] = to ?? null;
      }
    }

    if (Object.keys(newValues).length === 0) return;

    await this.record({
      ...entry,
      previousValues: previousValues as Prisma.InputJsonValue,
      newValues: newValues as Prisma.InputJsonValue,
    });
  }

  /**
   * Reads the trail, newest first, scoped to the caller's company and narrowed by
   * the optional filters. Read-only by construction — this class has no way to
   * amend or delete an entry.
   */
  async list(actor: AuthUser, query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      companyId: actor.companyId,
      ...(query.action ? { action: query.action as AuditAction } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };

    return paginate(query, {
      count: () => this.prisma.client.auditLog.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.auditLog.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            action: true,
            entityType: true,
            entityId: true,
            previousValues: true,
            newValues: true,
            reason: true,
            createdAt: true,
            actor: {
              select: {
                id: true,
                email: true,
                profile: { select: { firstName: true, lastName: true } },
              },
            },
          },
        }),
    });
  }
}
