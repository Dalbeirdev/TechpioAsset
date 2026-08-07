import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuditAction } from '@prisma/client';
import type {
  AdminUpdateProfileInput, InviteUserInput, SetUserRolesInput, SetUserStatusInput, UserListQuery } from '@techpioasset/contracts';
import type { AuthUser } from '@techpioasset/contracts';
import { findSodConflicts } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { buildOrderBy, paginate } from '../common/paginate.js';
import { userScopeFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { AppConfig } from '../config/config.module.js';
import { MailProvider } from '../providers/mail/mail.provider.js';
import { PrismaService } from '../prisma/prisma.service.js';

const SORTABLE = ['email', 'createdAt', 'lastLoginAt', 'status'] as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly mail: MailProvider,
    private readonly config: AppConfig,
  ) {}

  /** Scope + filters, ANDed (never spread — see AssetsService.list for why). */
  private listWhere(actor: AuthUser, query: UserListQuery) {
    return {
      AND: [
        userScopeFilter(actor),
        // Soft-deleted users are gone from every list; their history is not.
        { deletedAt: null },
        // Deactivated accounts have their own view - the default list shows
        // only people who can (or could, once invited) sign in.
        query.view === 'deactivated'
          ? { status: 'DEACTIVATED' as const }
          : { status: { not: 'DEACTIVATED' as const } },
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
  }

  async list(actor: AuthUser, query: UserListQuery) {
    const where = this.listWhere(actor, query);

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

  /** All users matching the list filters, flattened for CSV export (scoped, capped). */
  async exportRows(actor: AuthUser, query: UserListQuery) {
    const where = this.listWhere(actor, query);
    const users = await this.prisma.client.user.findMany({
      where,
      take: 10_000,
      orderBy: { email: 'asc' },
      select: {
        email: true,
        status: true,
        profile: {
          select: {
            firstName: true,
            lastName: true,
            employeeNumber: true,
            jobTitle: true,
            department: { select: { name: true } },
            office: { select: { name: true } },
          },
        },
        roles: { select: { role: { select: { name: true } } } },
      },
    });

    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'employeeNumber', label: 'Employee number' },
      { key: 'jobTitle', label: 'Job title' },
      { key: 'department', label: 'Department' },
      { key: 'office', label: 'Office' },
      { key: 'roles', label: 'Roles' },
      { key: 'status', label: 'Status' },
    ];
    const rows = users.map((u) => ({
      name: u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : '',
      email: u.email,
      employeeNumber: u.profile?.employeeNumber ?? '',
      jobTitle: u.profile?.jobTitle ?? '',
      department: u.profile?.department?.name ?? '',
      office: u.profile?.office?.name ?? '',
      roles: u.roles.map((r) => r.role.name).join('; '),
      status: u.status,
    }));

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.DATA_EXPORTED,
      entityType: 'User',
      entityId: 'export',
      newValues: { rows: rows.length },
    });

    return { columns, rows };
  }

  /**
   * Reads one user, honouring scope.
   *
   * A record outside the actor's scope returns 404, not 403. Distinguishing the
   * two tells the caller that a record exists at that id, which is the insecure
   * direct object reference the spec's security tests look for.
   */

  /**
   * v2.11 — profile fields finally have an editor.
   *
   * Until now NOBODY could set job title, department or office - not the user,
   * not an admin. The fields existed, the seed filled some of them, and every
   * profile rendered dashes forever after.
   *
   * `self` mode edits the caller's own record and refuses the org-placement
   * fields: department feeds the DEPARTMENT data scope, so a self-move would
   * let a user pick whose assets they can see. Admin mode (users:manage) may
   * place people. Both are audited with before/after.
   */
  async updateProfile(
    actor: AuthUser,
    targetUserId: string,
    input: AdminUpdateProfileInput,
    mode: 'self' | 'admin',
  ) {
    if (mode === 'self' && (input.departmentId !== undefined || input.officeId !== undefined || input.employeeNumber !== undefined)) {
      throw AppError.forbidden('Department, office and employee number are set by your administrator');
    }
    const user = await this.prisma.client.user.findFirst({
      where: { id: targetUserId, companyId: actor.companyId, deletedAt: null },
      select: { id: true, profile: true },
    });
    if (!user) throw AppError.notFound('User', targetUserId);

    if (input.departmentId) {
      const department = await this.prisma.client.department.findFirst({
        where: { id: input.departmentId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!department) throw AppError.notFound('Department', input.departmentId);
    }
    if (input.officeId) {
      const office = await this.prisma.client.office.findFirst({
        where: { id: input.officeId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!office) throw AppError.notFound('Office', input.officeId);
    }

    const patch = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.officeId !== undefined ? { officeId: input.officeId } : {}),
      ...(input.employeeNumber !== undefined ? { employeeNumber: input.employeeNumber } : {}),
    };

    const before = user.profile
      ? {
          firstName: user.profile.firstName,
          lastName: user.profile.lastName,
          jobTitle: user.profile.jobTitle,
          departmentId: user.profile.departmentId,
          officeId: user.profile.officeId,
        }
      : null;

    await this.prisma.client.userProfile.upsert({
      where: { userId: targetUserId },
      // A user with no profile row yet still deserves an editable profile;
      // names fall back to empty and can be corrected in the same breath.
      create: {
        userId: targetUserId,
        firstName: input.firstName ?? '',
        lastName: input.lastName ?? '',
        displayName: input.displayName ?? null,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle ?? null,
        ...(mode === 'admin'
          ? {
              departmentId: input.departmentId ?? null,
              officeId: input.officeId ?? null,
              employeeNumber: input.employeeNumber ?? null,
            }
          : {}),
        createdById: actor.id,
      },
      update: { ...patch, updatedById: actor.id },
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: targetUserId,
      previousValues: before ?? undefined,
      newValues: { ...patch, edited: mode === 'self' ? 'own profile' : 'by administrator' },
    });
    return this.findOne(actor, targetUserId);
  }

  async findOne(actor: AuthUser, id: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, deletedAt: null, ...userScopeFilter(actor) },
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
      where: { id, deletedAt: null, ...userScopeFilter(actor) },
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

    // WS-G — advisory SoD check over the UNION of the new roles: two
    // individually-clean roles can conflict when held together. Warns, never
    // blocks; the one hard SoD rule stays at decide time (BR-04).
    const grants = await this.prisma.client.rolePermission.findMany({
      where: { roleId: { in: roles.map((r) => r.id) } },
      select: { permission: { select: { key: true } } },
    });
    const sodConflicts = findSodConflicts(grants.map((g) => g.permission.key));

    const result = await this.findOne(actor, id);
    return { ...result, sodConflicts };
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

  /**
   * Invite a new user (v2.12) - the registration path tenant admins were
   * missing. Creates the account as INVITED with an unusable random password,
   * emails a 7-day single-use link, and returns that link ONCE so the inviter
   * can hand it over directly when email is not configured. The account cannot
   * sign in until the invite is accepted (INVITED blocks login).
   */
  /**
   * Who may invite: full user managers (users:manage) or HR-style inviters
   * (employees:create). The guard decorator can only AND permissions, so this
   * OR lives here - and it is also where the escalation line is held: an
   * inviter WITHOUT users:manage may only invite Registered Employees. HR
   * registering a joiner is fine; HR minting a Super Admin is not.
   */
  private assertMayInvite(actor: AuthUser, roleKeys?: string[]): void {
    const held = new Set(actor.permissions);
    const fullManager = held.has('users:manage');
    if (!fullManager && !held.has('employees:create')) {
      throw AppError.forbidden('You do not have permission to invite users');
    }
    if (!fullManager && roleKeys && (roleKeys.length !== 1 || roleKeys[0] !== 'EMPLOYEE')) {
      throw new AppError('FORBIDDEN', 'You may only invite Registered Employees', {
        detail:
          'Granting other roles needs user management permission - ask a user manager to change roles after the person joins.',
      });
    }
  }

  async invite(actor: AuthUser, input: InviteUserInput) {
    this.assertMayInvite(actor, input.roleKeys);
    const existing = await this.prisma.client.user.findFirst({
      where: { companyId: actor.companyId, email: input.email },
      select: { id: true, deletedAt: true },
    });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        existing.deletedAt
          ? 'A deleted account already uses this email address'
          : 'A user with this email already exists',
      );
    }

    if (input.departmentId) {
      const department = await this.prisma.client.department.findFirst({
        where: { id: input.departmentId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!department) throw AppError.notFound('Department', input.departmentId);
    }
    if (input.officeId) {
      const office = await this.prisma.client.office.findFirst({
        where: { id: input.officeId, companyId: actor.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!office) throw AppError.notFound('Office', input.officeId);
    }

    const roleKeys = [...new Set(input.roleKeys)];
    const roles = await this.prisma.client.role.findMany({
      where: { companyId: actor.companyId, key: { in: roleKeys } },
      select: { id: true, key: true },
    });
    if (roles.length !== roleKeys.length) {
      const found = new Set(roles.map((r) => r.key));
      throw new AppError('VALIDATION_FAILED', 'Unknown role', {
        detail: `No such role: ${roleKeys.filter((k) => !found.has(k)).join(', ')}`,
      });
    }

    // Unusable placeholder: random and never revealed, so the account has no
    // password anyone could guess until the invitee sets their own.
    const placeholder = await this.passwords.hash(randomBytes(32).toString('base64url'));

    const user = await this.prisma.client.user.create({
      data: {
        companyId: actor.companyId,
        email: input.email,
        passwordHash: placeholder,
        status: 'INVITED',
        profile: {
          create: {
            firstName: input.firstName,
            lastName: input.lastName,
            jobTitle: input.jobTitle ?? null,
            departmentId: input.departmentId ?? null,
            officeId: input.officeId ?? null,
          },
        },
        roles: { create: roles.map((r) => ({ roleId: r.id, createdById: actor.id })) },
      },
      select: { id: true, email: true },
    });

    const inviteUrl = await this.sendInviteLink(user.id, user.email, input.firstName);

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_CREATED,
      entityType: 'User',
      entityId: user.id,
      newValues: { email: user.email, roles: roleKeys, invited: true },
    });

    return { id: user.id, email: user.email, inviteUrl };
  }

  /**
   * Re-send an invitation (v2.12). Only INVITED accounts qualify - an active
   * account holding a fresh set-password link would be a password reset that
   * skipped the current password. Issuing the new token invalidates any
   * outstanding one, so exactly one link works at any moment.
   */
  async resendInvite(actor: AuthUser, id: string) {
    // Same OR gate as invite; no role restriction - resending changes nothing
    // about what the account will be able to do.
    this.assertMayInvite(actor);
    const target = await this.prisma.client.user.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true, email: true, status: true, profile: { select: { firstName: true } } },
    });
    if (!target) throw AppError.notFound('User', id);
    if (target.status !== 'INVITED') {
      throw new AppError('CONFLICT', 'This account has already been activated', {
        detail: 'Only accounts still in the Invited state can have their invitation re-sent.',
      });
    }

    const inviteUrl = await this.sendInviteLink(
      target.id,
      target.email,
      target.profile?.firstName ?? 'Hello',
    );

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: target.id,
      newValues: { email: target.email, note: 'Invitation re-sent - previous link invalidated' },
    });

    return { id: target.id, email: target.email, inviteUrl };
  }

  /** Issue a fresh invite token (killing any outstanding one) and email the link, best effort. */
  private async sendInviteLink(userId: string, email: string, firstName: string) {
    const token = await this.auth.issueInviteToken(userId);
    const inviteUrl = `${this.config.get('WEB_URL')}/accept-invite?token=${token}`;

    // Best effort: a mail failure must not lose the invite - the link is
    // returned to the inviter either way.
    try {
      await this.mail.send({
        to: email,
        subject: 'You have been invited to TechpioAsset',
        text: [
          `${firstName}, you have been invited to your company's TechpioAsset workspace.`,
          '',
          `Set your password and sign in here: ${inviteUrl}`,
          '',
          'The link is valid for 7 days and can be used once.',
        ].join('\n'),
      });
    } catch (error) {
      this.logger.error(`Invite email failed to send: ${(error as Error).message}`);
    }
    return inviteUrl;
  }

  /**
   * Sign in as another user (v2.12). The support move: see exactly what a
   * user sees, with their permissions and their scope - never more.
   *
   * The containment lines, each deliberate:
   *  - Super Admin accounts can never be impersonated. Nobody needs it, and
   *    it closes the only privilege-relevant direction.
   *  - The token is access-only and capped at 15 minutes: no refresh token is
   *    minted, so the session cannot be renewed - on expiry the browser's
   *    refresh cookie restores the administrator's own session.
   *  - Audited from BOTH identities: whatever the impersonated session does,
   *    the trail starts with who really did it.
   */
  async impersonate(actor: AuthUser, targetUserId: string) {
    if (targetUserId === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'You are already signed in as yourself');
    }
    const target = await this.prisma.client.user.findFirst({
      where: { id: targetUserId, companyId: actor.companyId, deletedAt: null },
      select: {
        id: true,
        email: true,
        status: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });
    if (!target) throw AppError.notFound('User', targetUserId);
    if (target.status !== 'ACTIVE') {
      throw new AppError('CONFLICT', 'Only active accounts can be impersonated');
    }
    if (target.roles.some((r) => r.role.key === 'SUPER_ADMIN')) {
      throw new AppError('FORBIDDEN', 'Super Admin accounts cannot be impersonated');
    }

    const user = await this.auth.buildAuthUser(target.id);
    const issued = await this.tokens.issueAccessOnly({
      userId: user.id,
      companyId: user.companyId,
      permissions: user.permissions,
      scope: user.scope,
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: target.id,
      newValues: {
        impersonation: true,
        impersonatedBy: actor.email,
        target: target.email,
        expiresInSeconds: issued.expiresIn,
      },
    });

    return { accessToken: issued.accessToken, expiresIn: issued.expiresIn, user };
  }

  /**
   * Soft delete (v2.11). The row keeps its id, profile, assignment history and
   * audit trail - "who had that laptop in 2025" must survive the person
   * leaving - but the user vanishes from every list, cannot sign in (status
   * DEACTIVATED + tokens revoked), and cannot be picked for new work.
   *
   * Deliberately refused while equipment is still out: deleting the holder of
   * three laptops would strand them in limbo. Return the assets first; the
   * error says exactly that.
   */
  async softDelete(actor: AuthUser, id: string) {
    if (id === actor.id) {
      throw new AppError('VALIDATION_FAILED', 'You cannot delete your own account');
    }
    const target = await this.loadInScope(actor, id);

    const isSuperAdmin = target.roles.some((r) => r.role.key === 'SUPER_ADMIN');
    if (
      isSuperAdmin &&
      target.status === 'ACTIVE' &&
      (await this.activeSuperAdminCount(actor.companyId)) <= 1
    ) {
      throw new AppError('VALIDATION_FAILED', 'The company must keep at least one active Super Admin', {
        detail: 'Make someone else a Super Admin before deleting this account.',
      });
    }

    const assetsOut = await this.prisma.client.assetAssignment.count({
      where: { userId: id, returnedAt: null },
    });
    if (assetsOut > 0) {
      throw new AppError(
        'CONFLICT',
        `${assetsOut} asset${assetsOut === 1 ? ' is' : 's are'} still assigned to this user`,
        { detail: 'Return or reassign their equipment first, then delete the account.' },
      );
    }

    await this.prisma.client.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DEACTIVATED' },
    });
    await this.tokens.revokeAllForUser(id, 'USER_DELETED');

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.USER_UPDATED,
      entityType: 'User',
      entityId: id,
      previousValues: { status: target.status, deletedAt: null },
      newValues: {
        status: 'DEACTIVATED',
        deleted: true,
        note: 'Soft delete - assignment history and audit trail retained',
      },
    });
  }
}
