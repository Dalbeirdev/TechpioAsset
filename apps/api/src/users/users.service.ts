import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { SetUserRolesInput, SetUserStatusInput, UserListQuery } from '@techpioasset/contracts';
import type { AuthUser } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { userScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SORTABLE = ['email', 'createdAt', 'lastLoginAt', 'status'] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, query: UserListQuery) {
    // ANDed, never spread - see AssetsService.list for why.
    const where = {
      AND: [
        userScopeFilter(actor),
        query.q
          ? {
              OR: [
                { email: { contains: query.q, mode: 'insensitive' as const } },
                { profile: { firstName: { contains: query.q, mode: 'insensitive' as const } } },
                { profile: { lastName: { contains: query.q, mode: 'insensitive' as const } } },
                {
                  profile: { employeeNumber: { contains: query.q, mode: 'insensitive' as const } },
                },
              ],
            }
          : {},
        query.role ? { roles: { some: { role: { key: query.role } } } } : {},
      ],
    };

    return paginate(query, {
      count: () => this.prisma.client.user.count({ where }),
      findMany: ({ skip, take }) =>
        this.prisma.client.user.findMany({
          where,
          skip,
          take,
          orderBy: buildOrderBy(query.sort, query.order, SORTABLE, 'createdAt'),
          select: {
            id: true,
            email: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
            mfaEnabledAt: true,
            profile: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
                jobTitle: true,
                employeeNumber: true,
                avatarKey: true,
                department: { select: { id: true, name: true } },
                office: { select: { id: true, name: true } },
                manager: { select: { id: true, email: true } },
              },
            },
            roles: { select: { role: { select: { key: true, name: true } } } },
          },
        }),
    });
  }

  /**
   * Reads one user, honouring scope.
   *
   * A record outside the actor's scope returns 404, not 403. Distinguishing the
   * two tells the caller that a record exists at that id, which is the insecure
   * direct object reference the spec's security tests look for.
   */
  async findOne(actor: AuthUser, id: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, ...userScopeFilter(actor) },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerifiedAt: true,
        mfaEnabledAt: true,
        lastLoginAt: true,
        createdAt: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
            jobTitle: true,
            phone: true,
            employeeNumber: true,
            avatarKey: true,
            hireDate: true,
            department: { select: { id: true, name: true } },
            office: { select: { id: true, name: true } },
            manager: { select: { id: true, email: true } },
          },
        },
        roles: { select: { role: { select: { key: true, name: true } } } },
      },
    });

    if (!user) throw AppError.notFound('User', id);
    return user;
  }

  /** Loads a user within the actor's scope, or 404s (never 403 — see findOne). */
  private async loadInScope(actor: AuthUser, id: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, ...userScopeFilter(actor) },
      select: {
        id: true,
        email: true,
        status: true,
        roles: { select: { role: { select: { id: true, key: true } } } },
      },
    });
    if (!user) throw AppError.notFound('User', id);
    return user;
  }

  /** How many active Super Admins the company has — the floor we must not cross. */
  private async activeSuperAdminCount(companyId: string): Promise<number> {
    return this.prisma.client.user.count({
      where: {
        companyId,
        status: 'ACTIVE',
        roles: { some: { role: { key: 'SUPER_ADMIN' } } },
      },
    });
  }

  /**
   * Replaces a user's roles wholesale (roles:manage). Guards against locking the
   * company out of administration: the last active Super Admin cannot be demoted.
   */
  async setRoles(actor: AuthUser, id: string, input: SetUserRolesInput) {
    const target = await this.loadInScope(actor, id);
    const currentKeys = target.roles.map((r) => r.role.key);
    const nextKeys = [...new Set(input.roleKeys)];

    const losingSuperAdmin =
      currentKeys.includes('SUPER_ADMIN') && !nextKeys.includes('SUPER_ADMIN');
    if (losingSuperAdmin && (await this.activeSuperAdminCount(actor.companyId)) <= 1) {
      throw new AppError('VALIDATION_FAILED', 'The company must keep at least one Super Admin', {
        detail: 'Grant Super Admin to another active user before removing it from this one.',
      });
    }

    const roles = await this.prisma.client.role.findMany({
      where: { companyId: actor.companyId, key: { in: nextKeys } },
      select: { id: true, key: true },
    });
    if (roles.length !== nextKeys.length) {
      const found = new Set(roles.map((r) => r.key));
      throw new AppError('VALIDATION_FAILED', 'Unknown role', {
        detail: `No such role: ${nextKeys.filter((k) => !found.has(k)).join(', ')}`,
      });
    }

    await this.prisma.client.$transaction([
      this.prisma.client.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.client.userRole.createMany({
        data: roles.map((r) => ({ userId: id, roleId: r.id, createdById: actor.id })),
      }),
    ]);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ROLE_CHANGED,
      entityType: 'User',
      entityId: id,
      previousValues: { roles: currentKeys },
      newValues: { roles: nextKeys },
    });

    return this.findOne(actor, id);
  }

  /**
   * Activates, suspends or deactivates a user (users:manage). You cannot change
   * your own status (no self-lockout), and the last active Super Admin cannot be
   * suspended or deactivated.
   */
  async setStatus(actor: AuthUser, id: string, input: SetUserStatusInput) {
    if (id === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'You cannot change your own account status');
    }
    const target = await this.loadInScope(actor, id);
    const isSuperAdmin = target.roles.some((r) => r.role.key === 'SUPER_ADMIN');
    const leavingActive = target.status === 'ACTIVE' && input.status !== 'ACTIVE';

    if (isSuperAdmin && leavingActive && (await this.activeSuperAdminCount(actor.companyId)) <= 1) {
      throw new AppError(
        'VALIDATION_FAILED',
        'The company must keep at least one active Super Admin',
        {
          detail: 'Activate another Super Admin before deactivating this one.',
        },
      );
    }

    await this.prisma.client.user.update({
      where: { id },
      data: { status: input.status },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      previousValues: { status: target.status },
      newValues: { status: input.status, reason: input.reason ?? null },
    });

    return this.findOne(actor, id);
  }
}
