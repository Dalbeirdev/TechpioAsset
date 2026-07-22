import { Injectable } from '@nestjs/common';
import type { AuthUser } from '@techpioasset/contracts';
import { tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Organisation structure and catalogue reads.
 *
 * These are reference data every authenticated user needs to render forms, so
 * they are readable by any signed-in user within their own company. Write paths
 * arrive with the admin screens; the seeded structure covers Phase 1.
 */
@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  offices(actor: AuthUser) {
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
    return this.prisma.client.vendor.findMany({
      where: { ...tenantFilter(actor), isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, contactEmail: true },
    });
  }
}
