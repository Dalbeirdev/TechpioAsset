import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { tenantFilter } from '../common/scope.js';
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
  ) {}

  private get ttl(): number {
    return this.config.get('CACHE_TTL_SECONDS');
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

  departments(actor: AuthUser) {
    return this.cache.wrap(`departments:${actor.companyId}`, this.ttl, () =>
      this.loadDepartments(actor),
    );
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
