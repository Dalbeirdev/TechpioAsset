import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import type {
  AddLicenseKeyInput,
  AssignSeatInput,
  AuthUser,
  CreateLicenseInput,
  CreateRenewalInput,
  LicenseListQuery,
  RevokeSeatInput,
  UpdateLicenseInput,
} from '@techpioasset/contracts';
import {
  PERMISSIONS,
  deriveLicenseStatus,
  resolveAssignmentPrincipal,
  seatLimitMessage,
  seatsAvailable,
  validatePoolAllocations,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { AuditService } from '../audit/audit.service.js';
import { AppConfig } from '../config/config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { decryptLicenseKey, encryptLicenseKey, maskLicenseKey } from './license-key.util.js';

const SORTABLE = ['name', 'expiryDate', 'purchaseDate', 'createdAt', 'seatsPurchased'] as const;

/**
 * v2.3 License Management. The scarce resource is SeatPool.seatsReserved: every
 * assign is an atomic conditional increment whose WHERE clause is the hard
 * limit, so two admins racing for the last seat cannot both win (blueprint
 * §A.7). v2.3 operates on the auto-created default pool; the schema already
 * supports splitting a licence into delegated pools later.
 */
@Injectable()
export class LicensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  // ── reads ──────────────────────────────────────────────────────────────────

  async list(actor: AuthUser, query: LicenseListQuery) {
    const where: Prisma.SoftwareLicenseWhereInput = {
      companyId: actor.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.family ? { family: query.family } : {}),
      ...(query.vendorId ? { vendorId: query.vendorId } : {}),
      ...(query.q
        ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { edition: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };

    const result = await paginate(query, {
      count: () => this.prisma.client.softwareLicense.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.softwareLicense.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: {
            ...this.baseSelect(actor),
            pools: { select: { seatsAllocated: true, seatsReserved: true } },
          },
        }),
    });

    const now = new Date();
    return {
      ...result,
      data: result.data.map((l) => this.shape(l, now)),
    };
  }

  async findOne(actor: AuthUser, id: string) {
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id, companyId: actor.companyId },
      select: {
        ...this.baseSelect(actor),
        notes: true,
        purchaseOrderNumber: true,
        invoiceId: true,
        pools: {
          select: { id: true, name: true, seatsAllocated: true, seatsReserved: true },
        },
        assignments: {
          orderBy: { assignedAt: 'desc' },
          take: 50,
          select: {
            id: true,
            status: true,
            assignedAt: true,
            revokedAt: true,
            reason: true,
            user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
            asset: { select: { id: true, assetTag: true, name: true } },
          },
        },
        renewals: {
          orderBy: { renewedAt: 'desc' },
          select: this.renewalSelect(actor),
        },
        keys: { select: { id: true, keyLast4: true, note: true, createdAt: true } },
      },
    });
    if (!license) throw AppError.notFound('License', id);

    const { keys, ...rest } = license;
    return {
      ...this.shape(rest, new Date()),
      keys: keys.map((k) => ({ id: k.id, masked: maskLicenseKey(k.keyLast4), note: k.note, createdAt: k.createdAt })),
    };
  }

  /** The caller's own active seats — every role may see what they hold. */
  async mine(actor: AuthUser) {
    const assignments = await this.prisma.client.licenseAssignment.findMany({
      where: { companyId: actor.companyId, userId: actor.id, status: 'ACTIVE' },
      orderBy: { assignedAt: 'desc' },
      select: {
        id: true,
        assignedAt: true,
        license: {
          select: { id: true, name: true, family: true, edition: true, expiryDate: true, status: true },
        },
      },
    });
    return assignments;
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  async create(actor: AuthUser, input: CreateLicenseInput) {
    if (input.costAmount != null && !this.canSeeCost(actor)) {
      throw new AppError('FORBIDDEN', 'Only Finance can record licence cost');
    }
    if (input.vendorId) {
      const vendor = await this.prisma.client.vendor.findFirst({
        where: { id: input.vendorId, companyId: actor.companyId },
        select: { id: true },
      });
      if (!vendor) throw AppError.notFound('Vendor', input.vendorId);
    }

    const license = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.softwareLicense.create({
        data: {
          companyId: actor.companyId,
          name: input.name,
          family: input.family,
          subscriptionType: input.subscriptionType,
          edition: input.edition ?? null,
          vendorId: input.vendorId ?? null,
          purchaseDate: input.purchaseDate,
          expiryDate: input.expiryDate ?? null,
          renewalDate: input.renewalDate ?? null,
          autoRenewal: input.autoRenewal ?? false,
          seatsPurchased: input.seatsPurchased,
          unitOfAssignment: input.unitOfAssignment,
          costAmount: input.costAmount ? new Prisma.Decimal(input.costAmount) : null,
          costCurrency: input.costCurrency ?? null,
          costModel: input.costModel ?? 'PER_SEAT',
          invoiceId: input.invoiceId ?? null,
          purchaseOrderNumber: input.purchaseOrderNumber ?? null,
          status: deriveLicenseStatus(input.expiryDate ?? null, new Date()),
          notes: input.notes ?? null,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true },
      });
      // Single-pool model in v2.3: all purchased seats live in the default pool.
      await tx.seatPool.create({
        data: {
          companyId: actor.companyId,
          licenseId: created.id,
          name: 'Default Pool',
          seatsAllocated: input.seatsPurchased,
          createdById: actor.id,
        },
      });
      return created;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_CREATED,
      entityType: 'SoftwareLicense',
      entityId: license.id,
      newValues: { name: input.name, seatsPurchased: input.seatsPurchased },
    });
    return this.findOne(actor, license.id);
  }

  async update(actor: AuthUser, id: string, input: UpdateLicenseInput) {
    const existing = await this.prisma.client.softwareLicense.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, status: true, expiryDate: true },
    });
    if (!existing) throw AppError.notFound('License', id);
    if (input.costAmount != null && !this.canSeeCost(actor)) {
      throw new AppError('FORBIDDEN', 'Only Finance can record licence cost');
    }

    await this.prisma.client.softwareLicense.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.edition !== undefined ? { edition: input.edition } : {}),
        ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
        ...(input.renewalDate !== undefined ? { renewalDate: input.renewalDate } : {}),
        ...(input.autoRenewal !== undefined ? { autoRenewal: input.autoRenewal } : {}),
        ...(input.costAmount !== undefined
          ? { costAmount: input.costAmount ? new Prisma.Decimal(input.costAmount) : null }
          : {}),
        ...(input.costCurrency !== undefined ? { costCurrency: input.costCurrency } : {}),
        ...(input.costModel !== undefined ? { costModel: input.costModel } : {}),
        ...(input.purchaseOrderNumber !== undefined
          ? { purchaseOrderNumber: input.purchaseOrderNumber }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.retired !== undefined
          ? {
              status: input.retired
                ? 'RETIRED'
                : deriveLicenseStatus(existing.expiryDate, new Date()),
            }
          : {}),
        updatedById: actor.id,
      },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_UPDATED,
      entityType: 'SoftwareLicense',
      entityId: id,
      newValues: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
    });
    return this.findOne(actor, id);
  }

  /** Soft delete. A licence with active seats cannot silently disappear. */
  async remove(actor: AuthUser, id: string) {
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id, companyId: actor.companyId },
      select: { id: true, name: true, _count: { select: { assignments: { where: { status: 'ACTIVE' } } } } },
    });
    if (!license) throw AppError.notFound('License', id);
    if (license._count.assignments > 0) {
      throw AppError.conflict(
        'CONFLICT',
        `Revoke the ${license._count.assignments} active seat(s) before deleting this licence`,
      );
    }
    await this.prisma.client.softwareLicense.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: actor.id },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_UPDATED,
      entityType: 'SoftwareLicense',
      entityId: id,
      previousValues: { name: license.name },
      reason: 'License deleted',
    });
    return { id, deleted: true };
  }

  // ── the flagship: seat assignment ──────────────────────────────────────────

  async assign(actor: AuthUser, licenseId: string, input: AssignSeatInput) {
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: {
        id: true,
        name: true,
        status: true,
        unitOfAssignment: true,
        seatsPurchased: true,
        pools: { select: { id: true, seatsReserved: true }, orderBy: { createdAt: 'asc' }, take: 1 },
      },
    });
    if (!license) throw AppError.notFound('License', licenseId);
    if (license.status === 'RETIRED' || license.status === 'EXPIRED') {
      throw new AppError('ILLEGAL_STATE_TRANSITION', `A ${license.status.toLowerCase()} licence cannot be assigned`);
    }
    const pool = license.pools[0];
    if (!pool) throw AppError.notFound('Seat pool');

    const principal = resolveAssignmentPrincipal(license.unitOfAssignment, input);
    if (!principal.ok) throw new AppError('VALIDATION_FAILED', principal.message);

    // The principal must be a live row in this tenant.
    if (principal.field === 'userId') {
      const user = await this.prisma.client.user.findFirst({
        where: { id: principal.id, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw AppError.notFound('User', principal.id);
    } else {
      const asset = await this.prisma.client.asset.findFirst({
        where: { id: principal.id, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!asset) throw AppError.notFound('Asset', principal.id);
    }

    try {
      const assignment = await this.prisma.client.$transaction(async (tx) => {
        // Atomic conditional increment — the WHERE clause IS the hard limit.
        const affected = await tx.$executeRaw`
          UPDATE "seat_pools"
             SET "seatsReserved" = "seatsReserved" + 1
           WHERE "id" = ${pool.id}
             AND "companyId" = ${actor.companyId}
             AND "seatsReserved" + 1 <= "seatsAllocated"`;
        if (affected === 0) {
          throw new AppError(
            'SEAT_LIMIT_EXCEEDED',
            seatLimitMessage({ purchased: license.seatsPurchased, reserved: pool.seatsReserved }),
          );
        }
        return tx.licenseAssignment.create({
          data: {
            companyId: actor.companyId,
            licenseId: license.id,
            seatPoolId: pool.id,
            [principal.field]: principal.id,
            assignedById: actor.id,
            reason: input.reason ?? null,
          },
          select: { id: true, userId: true, assetId: true },
        });
      });

      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.LICENSE_ASSIGNED,
        entityType: 'SoftwareLicense',
        entityId: license.id,
        newValues: { assignmentId: assignment.id, [principal.field]: principal.id },
      });
      return this.findOne(actor, license.id);
    } catch (error) {
      if (error instanceof AppError && error.code === 'SEAT_LIMIT_EXCEEDED') {
        // The refused 11th seat leaves a trail (blueprint §A.7d).
        await this.audit.record({
          companyId: actor.companyId,
          actorId: actor.id,
          action: AuditAction.LICENSE_ASSIGN_BLOCKED,
          entityType: 'SoftwareLicense',
          entityId: license.id,
          newValues: {
            reason: 'License limit exceeded',
            purchased: license.seatsPurchased,
            [principal.field]: principal.id,
          },
        });
        throw error;
      }
      // The partial unique index refuses a duplicate ACTIVE seat; translate it.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw AppError.conflict('CONFLICT', 'This principal already holds an active seat on this licence');
      }
      throw error;
    }
  }

  async revoke(actor: AuthUser, licenseId: string, input: RevokeSeatInput) {
    const assignment = await this.prisma.client.licenseAssignment.findFirst({
      where: { id: input.assignmentId, licenseId, companyId: actor.companyId, status: 'ACTIVE' },
      select: { id: true, seatPoolId: true, userId: true, assetId: true },
    });
    if (!assignment) throw AppError.notFound('Active assignment', input.assignmentId);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.licenseAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedById: actor.id,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
      // Guarded decrement: never below zero, whatever else happened.
      await tx.$executeRaw`
        UPDATE "seat_pools"
           SET "seatsReserved" = "seatsReserved" - 1
         WHERE "id" = ${assignment.seatPoolId}
           AND "companyId" = ${actor.companyId}
           AND "seatsReserved" > 0`;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_REVOKED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      previousValues: { assignmentId: assignment.id, userId: assignment.userId, assetId: assignment.assetId },
      reason: input.reason ?? undefined,
    });
    return this.findOne(actor, licenseId);
  }

  // ── renewals & keys ────────────────────────────────────────────────────────

  async renew(actor: AuthUser, licenseId: string, input: CreateRenewalInput) {
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: {
        id: true,
        expiryDate: true,
        seatsPurchased: true,
        pools: { select: { id: true, seatsAllocated: true, seatsReserved: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!license) throw AppError.notFound('License', licenseId);

    const delta = input.seatsDelta ?? 0;
    const nextPurchased = license.seatsPurchased + delta;
    if (nextPurchased < 0) {
      throw new AppError('VALIDATION_FAILED', 'A renewal cannot reduce seats below zero');
    }
    const defaultPool = license.pools[0];
    if (!defaultPool) throw AppError.notFound('Seat pool');
    const nextAllocated = defaultPool.seatsAllocated + delta;
    if (nextAllocated < defaultPool.seatsReserved) {
      throw AppError.conflict(
        'CONFLICT',
        `Cannot shrink to ${nextAllocated} seat(s): ${defaultPool.seatsReserved} are currently assigned`,
      );
    }
    const otherAllocations = license.pools.slice(1).map((p) => p.seatsAllocated);
    const check = validatePoolAllocations(nextPurchased, [nextAllocated, ...otherAllocations]);
    if (!check.ok) throw new AppError('VALIDATION_FAILED', check.message ?? 'Invalid allocation');

    await this.prisma.client.$transaction(async (tx) => {
      await tx.softwareLicense.update({
        where: { id: licenseId },
        data: {
          seatsPurchased: nextPurchased,
          ...(input.newExpiry !== undefined && input.newExpiry !== null
            ? { expiryDate: input.newExpiry, status: deriveLicenseStatus(input.newExpiry, new Date()) }
            : {}),
          updatedById: actor.id,
        },
      });
      await tx.seatPool.update({
        where: { id: defaultPool.id },
        data: { seatsAllocated: nextAllocated },
      });
      await tx.licenseRenewal.create({
        data: {
          companyId: actor.companyId,
          licenseId,
          previousExpiry: license.expiryDate,
          newExpiry: input.newExpiry ?? license.expiryDate,
          seatsDelta: delta,
          costAmount: input.costAmount ? new Prisma.Decimal(input.costAmount) : null,
          costCurrency: input.costCurrency ?? null,
          notes: input.notes ?? null,
          createdById: actor.id,
        },
      });
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_RENEWED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      newValues: { seatsDelta: delta, newExpiry: input.newExpiry?.toISOString() ?? null },
    });
    return this.findOne(actor, licenseId);
  }

  async addKey(actor: AuthUser, licenseId: string, input: AddLicenseKeyInput) {
    const secret = this.keySecret();
    const license = await this.prisma.client.softwareLicense.findFirst({
      where: { id: licenseId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!license) throw AppError.notFound('License', licenseId);

    const key = await this.prisma.client.licenseKey.create({
      data: {
        companyId: actor.companyId,
        licenseId,
        keyCiphertext: encryptLicenseKey(input.key, secret),
        keyLast4: input.key.slice(-4),
        note: input.note ?? null,
        createdById: actor.id,
      },
      select: { id: true, keyLast4: true },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_UPDATED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      reason: 'License key added',
    });
    return { id: key.id, masked: maskLicenseKey(key.keyLast4) };
  }

  /** Decrypts one key. Every reveal is audited — that is the deal. */
  async revealKey(actor: AuthUser, licenseId: string, keyId: string) {
    const secret = this.keySecret();
    const key = await this.prisma.client.licenseKey.findFirst({
      where: { id: keyId, licenseId, companyId: actor.companyId },
      select: { id: true, keyCiphertext: true },
    });
    if (!key) throw AppError.notFound('License key', keyId);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LICENSE_KEY_REVEALED,
      entityType: 'SoftwareLicense',
      entityId: licenseId,
      newValues: { keyId },
    });
    return { id: key.id, key: decryptLicenseKey(key.keyCiphertext, secret) };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private canSeeCost(actor: AuthUser): boolean {
    return actor.permissions.includes(PERMISSIONS.LICENSES_COST_READ);
  }

  private keySecret(): string {
    const secret = this.config.get('LICENSE_KEY_SECRET');
    if (!secret) {
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'License keys are not configured: set LICENSE_KEY_SECRET on the server first',
      );
    }
    return secret;
  }

  private baseSelect(actor: AuthUser) {
    return {
      id: true,
      name: true,
      family: true,
      subscriptionType: true,
      edition: true,
      purchaseDate: true,
      expiryDate: true,
      renewalDate: true,
      autoRenewal: true,
      seatsPurchased: true,
      unitOfAssignment: true,
      status: true,
      vendor: { select: { id: true, name: true } },
      createdAt: true,
      ...(this.canSeeCost(actor)
        ? { costAmount: true, costCurrency: true, costModel: true }
        : {}),
    } satisfies Prisma.SoftwareLicenseSelect;
  }

  private renewalSelect(actor: AuthUser) {
    return {
      id: true,
      renewedAt: true,
      previousExpiry: true,
      newExpiry: true,
      seatsDelta: true,
      notes: true,
      ...(this.canSeeCost(actor) ? { costAmount: true, costCurrency: true } : {}),
    } satisfies Prisma.LicenseRenewalSelect;
  }

  /** Derived numbers: reserved/available roll up from pools; status from dates. */
  private shape<T extends { pools: { seatsAllocated: number; seatsReserved: number }[]; seatsPurchased: number; status: string; expiryDate: Date | null }>(
    license: T,
    now: Date,
  ) {
    const reserved = license.pools.reduce((sum, p) => sum + p.seatsReserved, 0);
    return {
      ...license,
      seatsReserved: reserved,
      seatsAvailable: seatsAvailable(license.seatsPurchased, reserved),
      status:
        license.status === 'RETIRED' ? 'RETIRED' : deriveLicenseStatus(license.expiryDate, now),
    };
  }
}
