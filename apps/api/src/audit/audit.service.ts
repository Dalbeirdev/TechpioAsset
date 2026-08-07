import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, type Prisma } from '@prisma/client';
import type { AuditQuery, AuthUser } from '@techpioasset/contracts';
import { getRequestContext } from '../common/request-context.js';
import { paginate } from '../common/paginate.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheProvider } from '../providers/cache/cache.provider.js';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheProvider,
  ) {}

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
  /**
   * Resolve raw entity ids into the names a human recognises (v2.12) - "User
   * Sukhdev Singh", not "User cmxjaaie". One batched query per entity type on
   * the page, so the cost is a handful of IN() lookups regardless of page
   * size. Unknown types or deleted rows fall back to the id.
   */
  private async entityLabels(
    rows: { entityType: string; entityId: string }[],
  ): Promise<Map<string, string>> {
    const byType = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!byType.has(row.entityType)) byType.set(row.entityType, new Set());
      byType.get(row.entityType)!.add(row.entityId);
    }
    const labels = new Map<string, string>();
    const put = (type: string, id: string, label: string | null | undefined) => {
      if (label) labels.set(`${type}:${id}`, label);
    };

    const lookups: Promise<void>[] = [];
    for (const [type, idSet] of byType) {
      const ids = [...idSet];
      switch (type) {
        case 'User':
          lookups.push(
            this.prisma.client.user
              .findMany({
                where: { id: { in: ids } },
                select: {
                  id: true,
                  email: true,
                  profile: { select: { firstName: true, lastName: true } },
                },
              })
              .then((users) => {
                for (const u of users)
                  put(type, u.id, u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.email);
              }),
          );
          break;
        case 'Asset':
          lookups.push(
            this.prisma.client.asset
              .findMany({ where: { id: { in: ids } }, select: { id: true, assetTag: true, name: true } })
              .then((assets) => {
                for (const a of assets) put(type, a.id, `${a.assetTag} — ${a.name}`);
              }),
          );
          break;
        case 'Role':
          lookups.push(
            this.prisma.client.role
              .findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
              .then((roles) => {
                for (const r of roles) put(type, r.id, r.name);
              }),
          );
          break;
        case 'Office':
          lookups.push(
            this.prisma.client.office
              .findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
              .then((offices) => {
                for (const o of offices) put(type, o.id, o.name);
              }),
          );
          break;
        case 'AssetRequest':
        case 'Request':
          lookups.push(
            this.prisma.client.assetRequest
              .findMany({ where: { id: { in: ids } }, select: { id: true, requestNumber: true } })
              .then((requests) => {
                for (const r of requests) put(type, r.id, r.requestNumber);
              }),
          );
          break;
        case 'Invoice':
          lookups.push(
            this.prisma.client.invoice
              .findMany({ where: { id: { in: ids } }, select: { id: true, invoiceNumber: true } })
              .then((invoices) => {
                for (const inv of invoices) put(type, inv.id, inv.invoiceNumber);
              }),
          );
          break;
        default:
          break;
      }
    }
    await Promise.all(lookups);
    return labels;
  }

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

    const page = await paginate(query, {
      count: () => this.prisma.client.auditLog.count({ where }),
      // v2.10 S6 — the total is cached for 15 seconds; the page never is.
      //
      // The audit log is append-only, so a stale total can only ever be an
      // UNDERCOUNT by the events of the last few seconds, and the rows on the
      // page are always exact. Measured: the count was 78 ms over 2M index
      // entries and the dominant cost of this endpoint once S4 indexed the page
      // query down to 0.1 ms.
      countCache: {
        key: `techpioasset:audit:count:${actor.companyId}:${JSON.stringify(where)}`,
        ttlSeconds: 15,
        cache: this.cache,
      },
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

    // Attach human-readable entity labels to the page. Applies to every
    // audit:read holder equally - Finance sees exactly what an admin sees.
    const labels = await this.entityLabels(page.data);
    return {
      ...page,
      data: page.data.map((row) => ({
        ...row,
        entityLabel: labels.get(`${row.entityType}:${row.entityId}`) ?? null,
      })),
    };
  }
}
