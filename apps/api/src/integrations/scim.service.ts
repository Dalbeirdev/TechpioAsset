import { Injectable } from '@nestjs/common';
import type { ScimPatchInput, ScimUserInput } from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { AuthService } from '../auth/auth.service.js';
import { UsersService } from '../users/users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ScimPrincipal } from './scim.guard.js';

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

/**
 * v2.6 A3 — SCIM 2.0 user provisioning, BUILT TO CONTRACT (no live IdP exists
 * in this environment; RFC-shaped and integration-tested, stated honestly).
 *
 * Plan invariant 5: writes go through the same guarded paths as the UI —
 * role mapping uses UsersService.setRoles acting as the admin who minted the
 * token, so the last-Super-Admin floor, unknown-role refusal and audit all
 * hold. SCIM "deprovision" means DEACTIVATED (login blocked), never deletion.
 */
@Injectable()
export class ScimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  async listUsers(principal: ScimPrincipal, filter?: string) {
    // Minimal RFC 7644 filter: userName eq "value" - what IdPs actually send.
    const emailMatch = filter?.match(/^userName\s+eq\s+"([^"]+)"$/i);
    const rows = await this.prisma.client.user.findMany({
      where: {
        companyId: principal.companyId,
        deletedAt: null,
        ...(emailMatch ? { email: emailMatch[1]!.toLowerCase() } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: this.userInclude(),
    });
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: rows.length,
      startIndex: 1,
      itemsPerPage: rows.length,
      Resources: rows.map((u) => this.toScimUser(u)),
    };
  }

  async getUser(principal: ScimPrincipal, id: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, companyId: principal.companyId, deletedAt: null },
      include: this.userInclude(),
    });
    if (!user) throw AppError.notFound('User', id);
    return this.toScimUser(user);
  }

  async createUser(principal: ScimPrincipal, input: ScimUserInput) {
    const email = input.userName.toLowerCase();
    const existing = await this.prisma.client.user.findFirst({
      where: { companyId: principal.companyId, email },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict('CONFLICT', `User ${email} already exists (scimType: uniqueness)`);
    }

    const created = await this.prisma.client.user.create({
      data: {
        companyId: principal.companyId,
        email,
        status: input.active ? 'ACTIVE' : 'DEACTIVATED',
        // No password: the account signs in via SSO or a reset flow - SCIM
        // provisioning never transports credentials.
        profile: {
          create: {
            firstName: input.name?.givenName ?? email.split('@')[0]!,
            lastName: input.name?.familyName ?? '',
          },
        },
      },
      select: { id: true },
    });

    // Role mapping through the guarded path, acting as the token's minter.
    const roleKeys = input.roles?.map((r) => r.value) ?? [];
    await this.assignRoles(principal, created.id, roleKeys.length > 0 ? roleKeys : ['EMPLOYEE']);

    return this.getUser(principal, created.id);
  }

  async patchUser(principal: ScimPrincipal, id: string, input: ScimPatchInput) {
    const user = await this.prisma.client.user.findFirst({
      where: { id, companyId: principal.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw AppError.notFound('User', id);

    for (const op of input.Operations) {
      const opName = op.op.toLowerCase();
      if (opName !== 'replace' && opName !== 'add') {
        throw new AppError('VALIDATION_FAILED', `Unsupported SCIM op "${op.op}"`);
      }
      const active = this.extractActive(op.path, op.value);
      if (active === null) {
        throw new AppError('VALIDATION_FAILED', 'Only the "active" attribute is patchable');
      }
      await this.prisma.client.user.update({
        where: { id },
        data: { status: active ? 'ACTIVE' : 'DEACTIVATED' },
      });
    }
    return this.getUser(principal, id);
  }

  /** SCIM DELETE deprovisions (login blocked); it never destroys the record. */
  async deleteUser(principal: ScimPrincipal, id: string): Promise<void> {
    const result = await this.prisma.client.user.updateMany({
      where: { id, companyId: principal.companyId, deletedAt: null },
      data: { status: 'DEACTIVATED' },
    });
    if (result.count === 0) throw AppError.notFound('User', id);
  }

  scimError(status: number, detail: string) {
    return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async assignRoles(principal: ScimPrincipal, userId: string, roleKeys: string[]) {
    if (!principal.actorUserId) {
      throw new AppError('VALIDATION_FAILED', 'The SCIM token has no minting admin on record');
    }
    const actor = await this.auth.buildAuthUser(principal.actorUserId);
    await this.users.setRoles(actor, userId, { roleKeys });
  }

  private userInclude() {
    return {
      profile: { select: { firstName: true, lastName: true } },
      roles: { select: { role: { select: { key: true } } } },
    } as const;
  }

  private toScimUser(user: {
    id: string;
    email: string;
    status: string;
    createdAt: Date;
    profile: { firstName: string; lastName: string } | null;
    roles: { role: { key: string } }[];
  }) {
    return {
      schemas: [SCIM_USER_SCHEMA],
      id: user.id,
      userName: user.email,
      name: {
        givenName: user.profile?.firstName ?? '',
        familyName: user.profile?.lastName ?? '',
      },
      active: user.status === 'ACTIVE',
      roles: user.roles.map((r) => ({ value: r.role.key })),
      meta: { resourceType: 'User', created: user.createdAt.toISOString() },
    };
  }

  private extractActive(path: string | undefined, value: unknown): boolean | null {
    if (path?.toLowerCase() === 'active' && typeof value === 'boolean') return value;
    if (!path && typeof value === 'object' && value !== null && 'active' in value) {
      const active = (value as { active: unknown }).active;
      if (typeof active === 'boolean') return active;
      // Azure AD sends stringified booleans.
      if (active === 'True' || active === 'true') return true;
      if (active === 'False' || active === 'false') return false;
    }
    return null;
  }
}
