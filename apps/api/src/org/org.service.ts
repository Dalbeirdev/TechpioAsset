import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import type {
  AuthUser,
  CreateDepartmentInput,
  CreateOfficeInput,
  UpdateDepartmentInput,
  UpdateOfficeInput,
} from '@techpioasset/contracts';
import { AppError } from '../common/errors/app-error.js';
import { tenantFilter } from '../common/scope.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppConfig } from '../config/config.module.js';
import { CacheProvider } from '../providers/cache/cache.provider.js';

/**
 * Organisation structure and catalogue reads.
 *
 * These are reference data every authenticated user needs to render forms, so
 * they are readable by any signed-in user within their own company. They change
 * rarely and are read on nearly every screen, which makes them the natural place
 * to cache: each read is wrapped in a short-TTL, per-company cache entry (spec
 * section 1). Writes are not yet exposed here; when they are, they must call
 * `cache.del` for the company's keys.
 */
@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheProvider,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  private get ttl(): number {
    return this.config.get('CACHE_TTL_SECONDS');
  }

  /** The company's own settings - readable and writable by settings managers. */
  async companySettings(actor: AuthUser) {
    return this.prisma.client.company.findUniqueOrThrow({
      where: { id: actor.companyId },
      select: { name: true, legalName: true, baseCurrency: true, timezone: true, locale: true },
    });
  }

  async updateCompanySettings(
    actor: AuthUser,
    input: { name?: string; baseCurrency?: string; timezone?: string },
  ) {
    const before = await this.companySettings(actor);
    const after = await this.prisma.client.company.update({
      where: { id: actor.companyId },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.baseCurrency ? { baseCurrency: input.baseCurrency } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
      select: { name: true, legalName: true, baseCurrency: true, timezone: true, locale: true },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'Company',
      entityId: actor.companyId,
      previousValues: {
        name: before.name,
        baseCurrency: before.baseCurrency,
        timezone: before.timezone,
      },
      newValues: { name: after.name, baseCurrency: after.baseCurrency, timezone: after.timezone },
    });
    return after;
  }

  offices(actor: AuthUser) {
    return this.cache.wrap(`offices:${actor.companyId}`, this.ttl, () => this.loadOffices(actor));
  }

  private loadOffices(actor: AuthUser) {
    return this.prisma.client.office.findMany({
      where: { ...tenantFilter(actor), isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        city: true,
        country: true,
        buildings: {
          select: {
            id: true,
            name: true,
            floors: {
              select: {
                id: true,
                name: true,
                level: true,
                rooms: {
                  select: { id: true, name: true, code: true, isStorageLocation: true },
                  orderBy: { name: 'asc' },
                },
              },
              orderBy: { level: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Office management (v2.11). Offices were seed-only until now: readable
  // everywhere, creatable nowhere. Writes are SETTINGS_MANAGE because org
  // structure is company configuration, and every write busts the per-company
  // cache the readers sit behind.
  // ───────────────────────────────────────────────────────────────────────────

  private static readonly OFFICE_FIELDS = {
    id: true,
    code: true,
    name: true,
    addressLine1: true,
    addressLine2: true,
    city: true,
    region: true,
    postalCode: true,
    country: true,
    timezone: true,
    isActive: true,
  } as const;

  /** Full flat list for the management page - inactive offices included,
   * because "deactivated" and "invisible to the person who deactivated it"
   * are very different things. */
  officesForManagement(actor: AuthUser) {
    return this.prisma.client.office.findMany({
      where: { ...tenantFilter(actor), deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: OrgService.OFFICE_FIELDS,
    });
  }

  async createOffice(actor: AuthUser, input: CreateOfficeInput) {
    const code = input.code.toUpperCase();
    const clash = await this.prisma.client.office.findFirst({
      where: { companyId: actor.companyId, code },
      select: { id: true },
    });
    if (clash) {
      throw new AppError('CONFLICT', `An office with code ${code} already exists`);
    }
    const office = await this.prisma.client.office.create({
      data: { ...input, code, companyId: actor.companyId, createdById: actor.id },
      select: OrgService.OFFICE_FIELDS,
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'Office',
      entityId: office.id,
      newValues: { ...office, edited: 'office created' },
    });
    await this.cache.del(`offices:${actor.companyId}`);
    return office;
  }

  async updateOffice(actor: AuthUser, officeId: string, input: UpdateOfficeInput) {
    const before = await this.prisma.client.office.findFirst({
      where: { id: officeId, ...tenantFilter(actor), deletedAt: null },
      select: OrgService.OFFICE_FIELDS,
    });
    if (!before) throw new AppError('NOT_FOUND', 'Office not found');

    const code = input.code ? input.code.toUpperCase() : undefined;
    if (code && code !== before.code) {
      const clash = await this.prisma.client.office.findFirst({
        where: { companyId: actor.companyId, code, id: { not: officeId } },
        select: { id: true },
      });
      if (clash) {
        throw new AppError('CONFLICT', `An office with code ${code} already exists`);
      }
    }
    const office = await this.prisma.client.office.update({
      where: { id: officeId },
      data: { ...input, ...(code ? { code } : {}), updatedById: actor.id },
      select: OrgService.OFFICE_FIELDS,
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'Office',
      entityId: officeId,
      previousValues: before,
      newValues: office,
    });
    await this.cache.del(`offices:${actor.companyId}`);
    return office;
  }

  departments(actor: AuthUser) {
    return this.cache.wrap(`departments:${actor.companyId}`, this.ttl, () =>
      this.loadDepartments(actor),
    );
  }

  /** All departments, inactive included, for the management page. */
  departmentsForManagement(actor: AuthUser) {
    return this.prisma.client.department.findMany({
      where: { ...tenantFilter(actor), deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
        officeId: true,
        costCentre: true,
        headId: true,
        isActive: true,
        _count: { select: { profiles: true } },
      },
    });
  }

  async createDepartment(actor: AuthUser, input: CreateDepartmentInput) {
    const code = input.code.toUpperCase();
    const clash = await this.prisma.client.department.findFirst({
      where: { companyId: actor.companyId, code, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new AppError('CONFLICT', `A department with code ${code} already exists`);

    const department = await this.prisma.client.department.create({
      data: { ...input, code, companyId: actor.companyId, createdById: actor.id },
      select: { id: true, code: true, name: true, isActive: true },
    });
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.SETTING_CHANGED,
      entityType: 'Department',
      entityId: department.id,
      newValues: { ...department, edited: 'department created' },
    });
    await this.cache.del(`departments:${actor.companyId}`);
    return department;
  }

  async updateDepartment(actor: AuthUser, departmentId: string, input: UpdateDepartmentInput) {
    const before = await this.prisma.client.department.findFirst({
      where: { id: departmentId, ...tenantFilter(actor), deletedAt: null },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!before) throw new AppError('NOT_FOUND', 'Department not found');

    const code = input.code ? input.code.toUpperCase() : undefined;
    if (code && code !== before.code) {
      const clash = await this.prisma.client.department.findFirst({
        where: { companyId: actor.companyId, code, deletedAt: null, id: { not: departmentId } },
        select: { id: true },
      });
      if (clash) throw new AppError('CONFLICT', `A department with code ${code} already exists`);
    }
    // A department cannot be its own parent, and a two-step loop is just as bad.
    if (input.parentId && input.parentId === departmentId) {
      throw new AppError('VALIDATION_FAILED', 'A department cannot report to itself');
    }

    const after = await this.prisma.client.department.update({
      where: { id: departmentId },
      data: { ...input, ...(code ? { code } : {}), updatedById: actor.id },
      select: { id: true, code: true, name: true, isActive: true },
    });
    await this.audit.recordChange(
      {
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.SETTING_CHANGED,
        entityType: 'Department',
        entityId: departmentId,
      },
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
      ['code', 'name', 'isActive'],
    );
    await this.cache.del(`departments:${actor.companyId}`);
    return after;
  }

  private loadDepartments(actor: AuthUser) {
    return this.prisma.client.department.findMany({
      where: { ...tenantFilter(actor), isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
        costCentre: true,
        office: { select: { id: true, name: true } },
      },
    });
  }

  categories(actor: AuthUser) {
    return this.cache.wrap(`categories:${actor.companyId}`, this.ttl, () =>
      this.loadCategories(actor),
    );
  }

  private loadCategories(actor: AuthUser) {
    return this.prisma.client.category.findMany({
      where: { ...tenantFilter(actor), isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        icon: true,
        defaultTrackingType: true,
        subcategories: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, key: true, name: true },
        },
      },
    });
  }

  vendors(actor: AuthUser) {
    return this.cache.wrap(`vendors:${actor.companyId}`, this.ttl, () => this.loadVendors(actor));
  }

  private loadVendors(actor: AuthUser) {
    return this.prisma.client.vendor.findMany({
      where: { ...tenantFilter(actor), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, contactEmail: true },
    });
  }
}
