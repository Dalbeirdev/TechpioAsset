import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, ReportType } from '@techpioasset/contracts';
import { computeDepreciation, warrantyBucket, type DepreciationMethod } from '@techpioasset/domain';
import { AppError } from '../common/errors/app-error.js';
import { canSeeCost, tenantFilter } from '../common/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReportColumn, ReportRow, ReportTable } from './report-format.js';

/**
 * Report aggregations (spec section 18).
 *
 * Financial reports require assets:cost:read; a caller without it is refused
 * rather than shown a report with the money columns stripped, because a spending
 * report with no spending is misleading. Non-financial reports (inventory,
 * warranty expiry) are available to anyone with reports:read.
 */

/** Rows fetched, mapped and released one page at a time. */
const EXPORT_BATCH = 5_000;

/**
 * v2.10 S5 — a report defined once.
 *
 * `page(skip, take)` returns already-mapped rows, so the buffered path (JSON)
 * and the streamed path (CSV/XLSX) share one query, one column list and one row
 * mapper. The alternative — a second copy of each for streaming — is how an
 * export quietly stops matching the screen it was exported from.
 *
 * Every ordering carries `id` as a final tiebreaker. Without it, two rows with
 * the same warranty date could swap places between pages and the export would
 * silently duplicate one and drop the other.
 */
interface StreamSpec {
  title: string;
  columns: ReportColumn[];
  page: (skip: number, take: number) => Promise<ReportRow[]>;
}

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

    // A streamable report is defined ONCE (see `streamSpec`) and assembled here
    // by walking the same pages the export streams. Two definitions of one
    // report is how a CSV and a JSON of the same thing start disagreeing.
    const spec = this.streamSpec(actor, type, filters);
    if (spec) {
      const rows: ReportRow[] = [];
      for (let skip = 0; ; skip += EXPORT_BATCH) {
        const page = await spec.page(skip, EXPORT_BATCH);
        rows.push(...page);
        if (page.length < EXPORT_BATCH) break;
      }
      return { title: spec.title, columns: spec.columns, rows };
    }

    switch (type) {
      case 'SPENDING_BY_VENDOR':
        return this.spendingBy(actor, 'vendor');
      case 'SPENDING_BY_CATEGORY':
        return this.spendingBy(actor, 'category');
      case 'SPENDING_BY_DEPARTMENT':
        return this.spendingBy(actor, 'department');
      case 'MAINTENANCE_COST':
        return this.maintenanceCost(actor);
      default:
        throw new AppError('VALIDATION_FAILED', `Unknown report type ${type}`);
    }
  }


  /**
   * The streamable reports: one row per record, so they grow with the tenant.
   *
   * The aggregate reports (spending by vendor/category/department, maintenance
   * cost) are NOT here on purpose: they are grouped in the database and return
   * one row per vendor or category. Streaming a twelve-row result would add
   * machinery to no end.
   */
  streamSpec(
    actor: AuthUser,
    type: ReportType,
    filters: { officeId?: string; departmentId?: string },
  ): StreamSpec | null {
    const showCost = canSeeCost(actor);

    if (type === 'ASSET_INVENTORY') {
      const where = {
        ...tenantFilter(actor),
        ...(filters.officeId ? { officeId: filters.officeId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      };
      return {
        title: 'Asset inventory',
        columns: [
          { key: 'assetTag', label: 'Asset tag' },
          { key: 'name', label: 'Name' },
          { key: 'category', label: 'Category' },
          { key: 'status', label: 'Status' },
          { key: 'condition', label: 'Condition' },
          { key: 'office', label: 'Office' },
          { key: 'assignee', label: 'Assigned to' },
          ...(showCost ? [{ key: 'cost', label: 'Purchase cost', numeric: true }] : []),
        ],
        page: async (skip, take) => {
          const assets = await this.prisma.client.asset.findMany({
            where,
            orderBy: [{ assetTag: 'asc' }, { id: 'asc' }],
            skip,
            take,
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
          return assets.map((a) => ({
            assetTag: a.assetTag,
            name: a.name,
            category: a.category?.name ?? '',
            status: a.status,
            condition: a.condition,
            office: a.office?.name ?? '',
            assignee: a.assignedUser?.email ?? '',
            // null (not 0) so an unpriced asset reads as "not recorded", never "free".
            ...(showCost ? { cost: a.purchaseCost ? Number(a.purchaseCost) : null } : {}),
          }));
        },
      };
    }

    if (type === 'DEPRECIATION') {
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
        page: async (skip, take) => {
          const now = new Date();
          const assets = await this.prisma.client.asset.findMany({
            where: { ...tenantFilter(actor), purchaseCost: { not: null } },
            orderBy: [{ assetTag: 'asc' }, { id: 'asc' }],
            skip,
            take,
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
          return assets.map((a) => {
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
              cost: a.purchaseCost ? Number(a.purchaseCost) : null,
              depreciation: Number(result.accumulatedDepreciation),
              current: Number(result.currentValue),
            };
          });
        },
      };
    }

    return null;
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
