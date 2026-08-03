import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, type ApproverType, type RequestType } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import {
  ONBOARDING_TEMPLATE,
  ROLE_LABELS,
  WORKFLOW_TEMPLATES,
  ROLE_PERMISSIONS,
  READ_ONLY_ROLES,
  SYSTEM_ROLES,
  assertGrantAllowed,
} from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateTenantInput {
  name: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  baseCurrency?: string;
  timezone?: string;
}

/** The starter categories a fresh tenant can create assets under on day one. */
const CORE_CATEGORIES = [
  { key: 'it-assets', name: 'IT Assets', icon: 'laptop' },
  { key: 'furniture', name: 'Furniture', icon: 'armchair' },
  { key: 'office-equipment', name: 'Office Equipment', icon: 'printer' },
  { key: 'consumables', name: 'Consumables', icon: 'package' },
] as const;

/**
 * v2.6 A4 — tenant provisioning and oversight (plan invariant 4: additive and
 * audited; tenant users see zero change; cross-tenant reads happen ONLY here).
 *
 * Provisioning mirrors the seed's per-company steps from the same domain
 * sources (roles + grants from ROLE_PERMISSIONS/ROLE_LABELS, read-only
 * invariant re-asserted at write time). Deliberately lean beyond that: four
 * core categories and safe AI defaults; approval workflows and the full
 * category tree are runtime configuration the new tenant's admin owns
 * (spec section 11) - requests fall back to the platform's default behaviour
 * until a workflow is configured.
 */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  /** Every tenant with usage counts - the operator's overview. */
  async listTenants() {
    const companies = await this.prisma.client.company.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, isActive: true, createdAt: true, baseCurrency: true },
    });
    const [users, assets, licenses] = await Promise.all([
      this.prisma.client.user.groupBy({ by: ['companyId'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.client.asset.groupBy({ by: ['companyId'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.client.softwareLicense.groupBy({ by: ['companyId'], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    const count = (rows: { companyId: string; _count: { _all: number } }[], id: string) =>
      rows.find((r) => r.companyId === id)?._count._all ?? 0;
    return companies.map((company) => ({
      ...company,
      usage: {
        users: count(users, company.id),
        assets: count(assets, company.id),
        licenses: count(licenses, company.id),
      },
    }));
  }

  /**
   * Provision an isolated tenant: company, 13 system roles with their grants,
   * core categories, safe AI defaults, and ONE bootstrap Super Admin. The
   * generated password is returned exactly once, like every other secret.
   */
  async createTenant(actor: AuthUser, input: CreateTenantInput) {
    const email = input.adminEmail.toLowerCase();
    const existingUser = await this.prisma.client.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      throw AppError.conflict('CONFLICT', `A user with email ${email} already exists.`);
    }

    const initialPassword = `Tp!${randomBytes(12).toString('base64url')}`;
    const passwordHash = await this.passwords.hash(initialPassword);

    const permissions = await this.prisma.client.permission.findMany({
      select: { id: true, key: true },
    });
    const permissionIds = new Map(permissions.map((p) => [p.key, p.id]));

    const company = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name: input.name,
          baseCurrency: input.baseCurrency ?? 'USD',
          timezone: input.timezone ?? 'UTC',
          createdById: actor.id,
        },
        select: { id: true, name: true },
      });

      // Roles + grants from the SAME domain matrix the seed uses; the
      // read-only invariant is re-asserted at write time, exactly like seed.
      let superAdminRoleId: string | null = null;
      for (const roleKey of SYSTEM_ROLES) {
        const label = ROLE_LABELS[roleKey];
        const grants = ROLE_PERMISSIONS[roleKey];
        for (const permission of grants) assertGrantAllowed(roleKey, permission);
        const role = await tx.role.create({
          data: {
            companyId: created.id,
            key: roleKey,
            name: label.name,
            description: label.description,
            isSystem: true,
            isReadOnly: READ_ONLY_ROLES.includes(roleKey),
            createdById: actor.id,
          },
          select: { id: true },
        });
        if (roleKey === 'SUPER_ADMIN') superAdminRoleId = role.id;
        await tx.rolePermission.createMany({
          data: grants.flatMap((key) => {
            const permissionId = permissionIds.get(key);
            return permissionId ? [{ roleId: role.id, permissionId }] : [];
          }),
        });
      }

      for (const [index, category] of CORE_CATEGORIES.entries()) {
        await tx.category.create({
          data: {
            companyId: created.id,
            key: category.key,
            name: category.name,
            icon: category.icon,
            sortOrder: index,
            defaultTrackingType: 'INDIVIDUAL',
          },
        });
      }

      // AI: off, human review required - the same deliberate opt-ins as seed.
      await tx.aIConfiguration.create({
        data: {
          companyId: created.id,
          globallyEnabled: false,
          featureModes: {},
          confidenceThreshold: '0.85',
          alertThresholdPct: 80,
          retentionDays: 365,
          automaticFinancialApproval: false,
          humanReviewRequired: true,
          providerName: 'mock',
        },
      });

      // v2.7 R5: the standard approval chains, from the SAME templates the
      // seed uses. Without these a provisioned tenant's requests found no
      // workflow definition and skipped approval entirely - a fresh tenant
      // must be governed from its first request, not after someone notices.
      const roleIdByKey = new Map(
        (
          await tx.role.findMany({
            where: { companyId: created.id },
            select: { id: true, key: true },
          })
        ).map((r) => [r.key, r.id]),
      );
      for (const workflow of WORKFLOW_TEMPLATES) {
        const definition = await tx.workflowDefinition.create({
          data: {
            companyId: created.id,
            key: workflow.key,
            name: workflow.name,
            description: workflow.description,
            requestType: (workflow.requestType ?? null) as RequestType | null,
            createdById: actor.id,
          },
          select: { id: true },
        });
        for (const step of workflow.steps) {
          await tx.workflowStep.create({
            data: {
              workflowDefinitionId: definition.id,
              stepOrder: step.order,
              name: step.name,
              approverType: step.approverType as ApproverType,
              approverRoleId: step.roleKey ? (roleIdByKey.get(step.roleKey) ?? null) : null,
              costThreshold: step.costThreshold ? new Prisma.Decimal(step.costThreshold) : null,
              isSkippable: step.isSkippable ?? false,
              slaHours: step.slaHours ?? null,
            },
          });
        }
      }

      // The standard onboarding kit, so an HR-initiated onboarding has
      // something to draw from on day one.
      const categoryIdByKey = new Map(
        (
          await tx.category.findMany({
            where: { companyId: created.id },
            select: { id: true, key: true },
          })
        ).map((c) => [c.key, c.id]),
      );
      const template = await tx.onboardingTemplate.create({
        data: { companyId: created.id, key: ONBOARDING_TEMPLATE.key, name: ONBOARDING_TEMPLATE.name },
        select: { id: true },
      });
      await tx.onboardingTemplateItem.createMany({
        data: ONBOARDING_TEMPLATE.items.map((item, index) => ({
          templateId: template.id,
          description: item.description,
          quantity: new Prisma.Decimal(item.quantity),
          isRequired: item.isRequired,
          sortOrder: index,
          categoryId: categoryIdByKey.get(item.categoryKey) ?? null,
        })),
      });

      const admin = await tx.user.create({
        data: {
          companyId: created.id,
          email,
          passwordHash,
          status: 'ACTIVE',
          profile: { create: { firstName: input.adminFirstName, lastName: input.adminLastName } },
        },
        select: { id: true },
      });
      await tx.userRole.create({
        data: { userId: admin.id, roleId: superAdminRoleId!, createdById: actor.id },
      });

      return created;
    });

    await this.audit.record({
      companyId: company.id,
      actorId: actor.id,
      action: AuditAction.TENANT_CREATED,
      entityType: 'Company',
      entityId: company.id,
      newValues: { name: company.name, adminEmail: email, provisionedBy: actor.email },
    });
    this.logger.log(`Tenant "${company.name}" provisioned by ${actor.email}`);

    return {
      id: company.id,
      name: company.name,
      admin: { email, initialPassword },
      note: 'The initial password is shown ONCE. The admin should change it at first sign-in.',
    };
  }

  /** Suspend or reactivate a tenant. Suspension blocks every login (auth check). */
  async setActive(actor: AuthUser, id: string, isActive: boolean) {
    const company = await this.prisma.client.company.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, isActive: true },
    });
    if (!company) throw AppError.notFound('Tenant', id);
    if (company.id === actor.companyId && !isActive) {
      throw AppError.conflict('CONFLICT', 'You cannot suspend the tenant you are signed into.');
    }
    if (company.isActive === isActive) {
      return { id: company.id, name: company.name, isActive };
    }

    await this.prisma.client.company.update({
      where: { id },
      data: { isActive, updatedById: actor.id },
    });
    await this.audit.record({
      companyId: id,
      actorId: actor.id,
      action: isActive ? AuditAction.TENANT_ACTIVATED : AuditAction.TENANT_SUSPENDED,
      entityType: 'Company',
      entityId: id,
      previousValues: { isActive: company.isActive },
      newValues: { isActive, actedBy: actor.email },
    });
    return { id: company.id, name: company.name, isActive };
  }
}
