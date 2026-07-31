import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type { AuthUser, CreateRoleInput, UpdateRoleInput } from '@techpioasset/contracts';
import { ALL_PERMISSIONS, isReadOnlyPermission, type Permission } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

/**
 * v2.2 Workstream G — runtime custom-role management. A Super Admin (roles:manage)
 * creates, edits, and retires roles per tenant. System roles are immutable here
 * (seeded from the domain matrix); the read-only invariant is upheld — a role
 * flagged read-only can only ever hold read permissions, so an Auditor-style role
 * can never be handed a write grant.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The permission catalogue, grouped by resource, for the role editor. */
  listPermissions() {
    const groups = new Map<string, { key: string; action: string; readOnly: boolean }[]>();
    for (const key of ALL_PERMISSIONS) {
      const resource = key.split(':')[0] ?? key;
      const action = key.slice(resource.length + 1);
      const bucket = groups.get(resource) ?? [];
      bucket.push({ key, action, readOnly: isReadOnlyPermission(key) });
      groups.set(resource, bucket);
    }
    return {
      resources: [...groups.entries()].map(([resource, permissions]) => ({ resource, permissions })),
    };
  }

  /** Every role in the tenant, with grant and assignment counts. */
  async list(actor: AuthUser) {
    const roles = await this.prisma.client.role.findMany({
      where: { companyId: actor.companyId, deletedAt: null },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        isReadOnly: true,
        _count: { select: { permissions: true, users: true } },
      },
    });
    return roles.map(({ _count, ...r }) => ({
      ...r,
      permissionCount: _count.permissions,
      userCount: _count.users,
    }));
  }

  /** One role plus the permission keys it grants. */
  async findOne(actor: AuthUser, id: string) {
    const role = await this.prisma.client.role.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isSystem: true,
        isReadOnly: true,
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw AppError.notFound('Role', id);
    const { permissions, _count, ...rest } = role;
    return {
      ...rest,
      userCount: _count.users,
      permissions: permissions.map((p) => p.permission.key),
    };
  }

  async create(actor: AuthUser, input: CreateRoleInput) {
    const permissions = this.validatePermissions(input.permissions, input.isReadOnly);
    const key = await this.uniqueKey(actor.companyId, input.name);
    const permissionIds = await this.resolvePermissionIds(permissions);

    const role = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          companyId: actor.companyId,
          key,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          isReadOnly: input.isReadOnly ?? false,
          createdById: actor.id,
          updatedById: actor.id,
        },
        select: { id: true },
      });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId: created.id,
            permissionId,
            createdById: actor.id,
          })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ROLE_CHANGED,
      entityType: 'Role',
      entityId: role.id,
      newValues: { name: input.name, permissions },
      reason: 'Role created',
    });
    return this.findOne(actor, role.id);
  }

  async update(actor: AuthUser, id: string, input: UpdateRoleInput) {
    const role = await this.prisma.client.role.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: {
        id: true,
        isSystem: true,
        isReadOnly: true,
        permissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!role) throw AppError.notFound('Role', id);
    if (role.isSystem) {
      throw AppError.forbidden('System roles cannot be edited');
    }

    const nextPermissions =
      input.permissions !== undefined
        ? this.validatePermissions(input.permissions, role.isReadOnly)
        : null;
    const nextIds = nextPermissions ? await this.resolvePermissionIds(nextPermissions) : null;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedById: actor.id,
        },
      });
      if (nextIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (nextIds.length) {
          await tx.rolePermission.createMany({
            data: nextIds.map((permissionId) => ({ roleId: id, permissionId, createdById: actor.id })),
            skipDuplicates: true,
          });
        }
      }
    });

    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ROLE_CHANGED,
      entityType: 'Role',
      entityId: id,
      previousValues: { permissions: role.permissions.map((p) => p.permission.key) },
      newValues: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(nextPermissions ? { permissions: nextPermissions } : {}),
      },
      reason: 'Role updated',
    });
    return this.findOne(actor, id);
  }

  /** Soft-delete a custom role. System roles and roles still in use are protected. */
  async remove(actor: AuthUser, id: string) {
    const role = await this.prisma.client.role.findFirst({
      where: { id, companyId: actor.companyId, deletedAt: null },
      select: { id: true, key: true, name: true, isSystem: true, _count: { select: { users: true } } },
    });
    if (!role) throw AppError.notFound('Role', id);
    if (role.isSystem) {
      throw AppError.forbidden('System roles cannot be deleted');
    }
    if (role._count.users > 0) {
      throw AppError.conflict(
        'CONFLICT',
        `Reassign the ${role._count.users} member(s) holding this role before deleting it`,
      );
    }

    // Soft-delete, but release the human key so the same name can be reused later
    // (reads filter deletedAt, yet the unique [companyId, key] still counts tombstones).
    await this.prisma.client.role.update({
      where: { id },
      data: { deletedAt: new Date(), key: `${role.key}__deleted_${Date.now().toString(36)}` },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.ROLE_CHANGED,
      entityType: 'Role',
      entityId: id,
      previousValues: { name: role.name },
      reason: 'Role deleted',
    });
    return { id, deleted: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Validate keys against the catalogue and the read-only invariant. */
  private validatePermissions(keys: string[], readOnly?: boolean): Permission[] {
    const unique = [...new Set(keys)];
    const unknown = unique.filter((k) => !PERMISSION_SET.has(k));
    if (unknown.length) {
      throw new AppError('VALIDATION_FAILED', `Unknown permission(s): ${unknown.join(', ')}`);
    }
    if (readOnly) {
      const writes = unique.filter((k) => !isReadOnlyPermission(k as Permission));
      if (writes.length) {
        throw new AppError(
          'VALIDATION_FAILED',
          `A read-only role cannot hold write permission(s): ${writes.join(', ')}`,
        );
      }
    }
    return unique as Permission[];
  }

  /** Resolve permission keys to catalogue ids. The catalogue is global reference data. */
  private async resolvePermissionIds(keys: Permission[]): Promise<string[]> {
    if (!keys.length) return [];
    const rows = await this.prisma.client.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Derive a stable, unique UPPER_SNAKE key from the display name. */
  private async uniqueKey(companyId: string, name: string): Promise<string> {
    const base =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'ROLE';
    const clash = await this.prisma.client.role.findFirst({
      where: { companyId, key: base },
      select: { id: true },
    });
    if (!clash) return base;
    // Append a short suffix rather than silently reusing an existing key.
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    return `${base}_${suffix}`.slice(0, 60);
  }
}
