import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, ReportType } from '@techpioasset/contracts';
import { computeDepreciation, warrantyBucket, type DepreciationMethod } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { canSeeCost, tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReportTable } from './report-format.js';

/**
 * Report aggregations (spec section 18).
 *
 * Financial reports require assets:cost:read; a caller without it is refused
 * rather than shown a report with the money columns stripped, because a spending
 * report with no spending is misleading. Non-financial reports (inventory,
 * warranty expiry) are available to anyone with reports:read.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly FINANCIAL: ReportType[] = [
    'SPENDING_BY_VENDOR',
    'SPENDING_BY_CATEGORY',
    'SPENDING_BY_DEPARTMENT',
    'DEPRECIATION',
    'MAINTENANCE_COST',
  ];

  async build(
    actor: AuthUser,
    type: ReportType,
    filters: { officeId?: string; departmentId?: string },
  ): Promise<ReportTable> {
    if (this.FINANCIAL.includes(type) && !canSeeCost(actor)) {
      throw AppError.forbidden('This report includes financial data you are not permitted to see');
    }

    switch (type) {
      case 'ASSET_INVENTORY':
        return this.assetInventory(actor, filters);
      case 'SPENDING_BY_VENDOR':
        return this.spendingBy(actor, 'vendor');
      case 'SPENDING_BY_CATEGORY':
        return this.spendingBy(actor, 'category');
      case 'SPENDING_BY_DEPARTMENT':
        return this.spendingBy(actor, 'department');
      case 'DEPRECIATION':
        return this.depreciation(actor);
      case 'WARRANTY_EXPIRY':
        return this.warrantyExpiry(actor);
      case 'MAINTENANCE_COST':
        return this.maintenanceCost(actor);
      default:
        throw new AppError('VALIDATION_FAILED', `Unknown report type ${type}`);
    }
  }

  private async assetInventory(
    actor: AuthUser,
    filters: { officeId?: string; departmentId?: string },
  ): Promise<ReportTable> {
    const showCost = canSeeCost(actor);
    const assets = await this.prisma.client.asset.findMany({
      where: {
        ...tenantFilter(actor),
        ...(filters.officeId ? { officeId: filters.officeId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      },
      orderBy: { assetTag: 'asc' },
      select: {
        assetTag: true,
        name: true,
        status: true,
        condition: true,
        serialNumber: true,
        purchaseCost: showCost,
        currency: showCost,
        category: { select: { name: true } },
        office: { select: { name: true } },
        assignedUser: { select: { email: true } },
      },
    });

    const columns = [
      { key: 'assetTag', label: 'Asset tag' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'condition', label: 'Condition' },
      { key: 'office', label: 'Office' },
      { key: 'assignee', label: 'Assigned to' },
      ...(showCost ? [{ key: 'cost', label: 'Purchase cost', numeric: true }] : []),
    ];

    return {
      title: 'Asset inventory',
      columns,
      rows: assets.map((a) => ({
        assetTag: a.assetTag,
        name: a.name,
        category: a.category?.name ?? '',
        status: a.status,
        condition: a.condition,
        office: a.office?.name ?? '',
        assignee: a.assignedUser?.email ?? '',
        ...(showCost ? { cost: a.purchaseCost ? Number(a.purchaseCost) : 0 } : {}),
      })),
    };
  }

  private async spendingBy(
    actor: AuthUser,
    dimension: 'vendor' | 'category' | 'department',
  ): Promise<ReportTable> {
    // Aggregate asset purchase cost by the chosen dimension. Grouped in SQL for
    // correctness on large estates rather than summed in application code.
    const assets = await this.prisma.client.asset.findMany({
      where: { ...tenantFilter(actor), purchaseCost: { not: null } },
      select: {
        purchaseCost: true,
        currency: true,
        vendor: { select: { name: true } },
        category: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    const totals = new Map<string, { total: Prisma.Decimal; count: number }>();
    for (const asset of assets) {
      const key =
        dimension === 'vendor'
          ? (asset.vendor?.name ?? 'Unassigned')
          : dimension === 'category'
            ? (asset.category?.name ?? 'Uncategorised')
            : (asset.department?.name ?? 'No department');
      const entry = totals.get(key) ?? { total: new Prisma.Decimal(0), count: 0 };
      entry.total = entry.total.plus(asset.purchaseCost ?? 0);
      entry.count += 1;
      totals.set(key, entry);
    }

    const label = dimension.charAt(0).toUpperCase() + dimension.slice(1);
    return {
      title: `Spending by ${dimension}`,
      columns: [
        { key: 'name', label },
        { key: 'count', label: 'Assets', numeric: true },
        { key: 'total', label: 'Total spend', numeric: true },
      ],
      rows: [...totals.entries()]
        .sort((a, b) => b[1].total.comparedTo(a[1].total))
        .map(([name, entry]) => ({
          name,
          count: entry.count,
          total: Number(entry.total.toFixed(2)),
        })),
    };
  }

  private async depreciation(actor: AuthUser): Promise<ReportTable> {
    const assets = await this.prisma.client.asset.findMany({
      where: { ...tenantFilter(actor), purchaseCost: { not: null } },
      orderBy: { assetTag: 'asc' },
      select: {
        assetTag: true,
        name: true,
        purchaseCost: true,
        salvageValue: true,
        usefulLifeMonths: true,
        depreciationMethod: true,
        purchaseDate: true,
      },
    });

    const now = new Date();
    return {
      title: 'Depreciation',
      columns: [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'name', label: 'Name' },
        { key: 'method', label: 'Method' },
        { key: 'cost', label: 'Purchase cost', numeric: true },
        { key: 'depreciation', label: 'Accumulated', numeric: true },
        { key: 'current', label: 'Current value', numeric: true },
      ],
      rows: assets.map((a) => {
        const result = computeDepreciation({
          method: a.depreciationMethod as DepreciationMethod,
          purchaseCost: a.purchaseCost?.toString() ?? '0',
          salvageValue: a.salvageValue?.toString() ?? '0',
          usefulLifeMonths: a.usefulLifeMonths,
          purchaseDate: a.purchaseDate ?? now,
          asOf: now,
        });
        return {
          assetTag: a.assetTag,
          name: a.name,
          method: a.depreciationMethod,
          cost: a.purchaseCost ? Number(a.purchaseCost) : 0,
          depreciation: Number(result.accumulatedDepreciation),
          current: Number(result.currentValue),
        };
      }),
    };
  }

  private async warrantyExpiry(actor: AuthUser): Promise<ReportTable> {
    const assets = await this.prisma.client.asset.findMany({
      where: { ...tenantFilter(actor), warrantyEndDate: { not: null } },
      orderBy: { warrantyEndDate: 'asc' },
      select: {
        assetTag: true,
        name: true,
        warrantyEndDate: true,
        vendor: { select: { name: true } },
      },
    });

    const now = new Date();
    return {
      title: 'Warranty expiry',
      columns: [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'name', label: 'Name' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'endDate', label: 'Warranty ends' },
        { key: 'bucket', label: 'Window' },
      ],
      rows: assets.map((a) => ({
        assetTag: a.assetTag,
        name: a.name,
        vendor: a.vendor?.name ?? '',
        endDate: a.warrantyEndDate?.toISOString().slice(0, 10) ?? '',
        bucket: warrantyBucket(a.warrantyEndDate, now),
      })),
    };
  }

  private async maintenanceCost(actor: AuthUser): Promise<ReportTable> {
    const records = await this.prisma.client.maintenanceRecord.findMany({
      where: { asset: tenantFilter(actor), serviceCost: { not: null } },
      orderBy: { completedAt: 'desc' },
      select: {
        title: true,
        type: true,
        serviceCost: true,
        downtimeHours: true,
        completedAt: true,
        asset: { select: { assetTag: true } },
      },
    });

    return {
      title: 'Maintenance cost',
      columns: [
        { key: 'assetTag', label: 'Asset tag' },
        { key: 'title', label: 'Work' },
        { key: 'type', label: 'Type' },
        { key: 'cost', label: 'Service cost', numeric: true },
        { key: 'downtime', label: 'Downtime (h)', numeric: true },
        { key: 'completed', label: 'Completed' },
      ],
      rows: records.map((r) => ({
        assetTag: r.asset.assetTag,
        title: r.title,
        type: r.type,
        cost: r.serviceCost ? Number(r.serviceCost) : 0,
        downtime: r.downtimeHours ? Number(r.downtimeHours) : 0,
        completed: r.completedAt?.toISOString().slice(0, 10) ?? '',
      })),
    };
  }
}
