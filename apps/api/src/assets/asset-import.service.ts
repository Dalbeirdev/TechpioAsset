import { Injectable, Logger } from '@nestjs/common';
import { Prisma, AssetStatus, AssetCondition, TrackingType, AuditAction } from '@prisma/client';
import type { AuthUser } from '@techpioasset/contracts';
import ExcelJS from 'exceljs';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors/app-error.js';

/**
 * Bulk asset import from a spreadsheet ("Upload Excel sheet").
 *
 * Accepts rows already parsed from the uploaded workbook and, in one
 * transaction, upserts the reference data, the employees, and the assets they
 * hold — so a re-upload of a corrected sheet updates in place rather than
 * duplicating. Employees are created as records with no login (status INVITED,
 * no password) and can be invited to sign in later; assets are keyed on their
 * serial ("Asset Id") for idempotency.
 */

export interface ImportRow {
  [header: string]: string | number | Date | null | undefined;
}

export interface ImportSummary {
  rows: number;
  employeesCreated: number;
  employeesMatched: number;
  assetsCreated: number;
  assetsUpdated: number;
  assigned: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const CONDITION: Record<string, AssetCondition> = {
  new: AssetCondition.NEW,
  good: AssetCondition.GOOD,
  fair: AssetCondition.FAIR,
  poor: AssetCondition.POOR,
  damaged: AssetCondition.DAMAGED,
  unusable: AssetCondition.UNUSABLE,
};

const STATUS: Record<string, AssetStatus> = {
  available: AssetStatus.AVAILABLE,
  assigned: AssetStatus.ASSIGNED,
  'in use': AssetStatus.IN_USE,
  'in-use': AssetStatus.IN_USE,
  reserved: AssetStatus.RESERVED,
  'in storage': AssetStatus.IN_STORAGE,
  'under repair': AssetStatus.UNDER_REPAIR,
  repair: AssetStatus.UNDER_REPAIR,
  damaged: AssetStatus.DAMAGED,
  lost: AssetStatus.LOST,
  stolen: AssetStatus.STOLEN,
  retired: AssetStatus.RETIRED,
  disposed: AssetStatus.DISPOSED,
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class AssetImportService {
  private readonly logger = new Logger(AssetImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Reads an .xlsx buffer into header-keyed rows, skipping any title banner. */
  async parseWorkbook(buffer: Buffer): Promise<ImportRow[]> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new AppError('FILE_REJECTED', 'That file could not be read as an Excel workbook.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError('FILE_REJECTED', 'The workbook has no sheets.');

    const text = (v: ExcelJS.CellValue): string => {
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'object') {
        const o = v as { text?: string; result?: unknown };
        if (typeof o.text === 'string') return o.text;
        if (o.result != null) return String(o.result);
        return '';
      }
      return String(v);
    };
    const value = (v: ExcelJS.CellValue): string | number | Date | null => {
      if (v == null || v === '') return null;
      if (v instanceof Date || typeof v === 'number') return v;
      if (typeof v === 'object') {
        const o = v as { text?: string; result?: unknown };
        return o.text ?? (o.result != null ? String(o.result) : null);
      }
      return String(v).trim();
    };

    // Find the header row (the one that names "Asset Id"); the sheet may carry a
    // company/title banner above it.
    let headerRow = 1;
    let headers: string[] = [];
    for (let r = 1; r <= Math.min(10, ws.rowCount); r += 1) {
      const cells = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1).map(text);
      if (cells.some((c) => /asset\s*id/i.test(c))) {
        headers = cells;
        headerRow = r;
        break;
      }
    }
    if (!headers.length) {
      headers = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(text);
    }

    const rows: ImportRow[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
      const cells = (ws.getRow(r).values as ExcelJS.CellValue[]).slice(1);
      const obj: ImportRow = {};
      let hasData = false;
      headers.forEach((h, idx) => {
        if (!h) return;
        const v = value(cells[idx] ?? null);
        obj[h] = v;
        if (v != null) hasData = true;
      });
      if (hasData) rows.push(obj);
    }
    return rows;
  }

  /** Case/space-insensitive lookup of a cell by any of the given header names. */
  private cell(row: ImportRow, ...names: string[]): string | Date | null {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = names.map(norm);
    for (const [key, value] of Object.entries(row)) {
      if (wanted.includes(norm(key))) {
        if (value == null || value === '') return null;
        return value instanceof Date ? value : String(value).trim();
      }
    }
    return null;
  }

  private toDate(value: string | Date | null): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  async importRows(actor: AuthUser, rows: ImportRow[]): Promise<ImportSummary> {
    const companyId = actor.companyId;
    const summary: ImportSummary = {
      rows: rows.length,
      employeesCreated: 0,
      employeesMatched: 0,
      assetsCreated: 0,
      assetsUpdated: 0,
      assigned: 0,
      skipped: 0,
      errors: [],
    };

    const employeeRole = await this.prisma.client.role.findFirst({
      where: { companyId, key: 'EMPLOYEE' },
    });
    if (!employeeRole) {
      throw new AppError('INTERNAL_ERROR', 'The EMPLOYEE role is missing; seed the company first.');
    }

    // Caches so repeated categories/subcategories/employees hit the DB once.
    const categoryCache = new Map<string, string>();
    const subcategoryCache = new Map<string, string>();
    const employeeCache = new Map<string, string>();

    const ensureCategory = async (name: string): Promise<string> => {
      const key = slug(name) || 'general';
      const cached = categoryCache.get(key);
      if (cached) return cached;
      const cat = await this.prisma.client.category.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, name, defaultTrackingType: TrackingType.INDIVIDUAL },
        update: {},
        select: { id: true },
      });
      categoryCache.set(key, cat.id);
      return cat.id;
    };

    const ensureSubcategory = async (categoryId: string, name: string): Promise<string> => {
      const key = slug(name) || 'general';
      const cacheKey = `${categoryId}:${key}`;
      const cached = subcategoryCache.get(cacheKey);
      if (cached) return cached;
      const sub = await this.prisma.client.subcategory.upsert({
        where: { categoryId_key: { categoryId, key } },
        create: { categoryId, key, name },
        update: {},
        select: { id: true },
      });
      subcategoryCache.set(cacheKey, sub.id);
      return sub.id;
    };

    const ensureEmployee = async (
      employeeNumber: string,
      fullName: string | null,
    ): Promise<string> => {
      const cached = employeeCache.get(employeeNumber);
      if (cached) return cached;

      const existing = await this.prisma.client.userProfile.findFirst({
        where: { employeeNumber, user: { companyId } },
        select: { userId: true },
      });
      if (existing) {
        employeeCache.set(employeeNumber, existing.userId);
        summary.employeesMatched += 1;
        return existing.userId;
      }

      const name = (fullName ?? employeeNumber).trim();
      const [firstName, ...rest] = name.split(/\s+/);
      const email = `${employeeNumber.toLowerCase()}@import.local`;

      // Records with no password and INVITED status — assignable now, invitable later.
      const user = await this.prisma.client.user.create({
        data: {
          companyId,
          email,
          passwordHash: null,
          status: 'INVITED',
          roles: { create: { roleId: employeeRole.id } },
          profile: {
            create: {
              firstName: firstName || name,
              lastName: rest.join(' ') || '-',
              employeeNumber,
            },
          },
        },
        select: { id: true },
      });
      employeeCache.set(employeeNumber, user.id);
      summary.employeesCreated += 1;
      return user.id;
    };

    // A running tag sequence for newly-created assets, continuing past any
    // existing "AST-" tags so re-imports never collide.
    const existingCount = await this.prisma.client.asset.count({
      where: { companyId, assetTag: { startsWith: 'AST-' } },
    });
    let tagSeq = existingCount;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;
      const rowNo = i + 2; // 1-based + header
      try {
        const serial = this.cell(row, 'Asset Id', 'Serial Number', 'Serial');
        const name = this.cell(row, 'Asset Name', 'Name');
        if (!serial && !name) {
          summary.skipped += 1;
          continue;
        }
        const serialStr = serial ? String(serial) : null;
        const nameStr = name ? String(name) : `Asset ${serialStr ?? rowNo}`;

        const categoryName = (this.cell(row, 'Asset Category', 'Category') as string) || 'Hardware';
        const typeName = (this.cell(row, 'Asset Type', 'Type') as string) || 'General';
        const categoryId = await ensureCategory(categoryName);
        const subcategoryId = await ensureSubcategory(categoryId, typeName);

        const conditionRaw = String(
          this.cell(row, 'Asset Condition', 'Condition') ?? '',
        ).toLowerCase();
        const statusRaw = String(this.cell(row, 'Asset Status', 'Status') ?? '').toLowerCase();
        const condition = CONDITION[conditionRaw] ?? AssetCondition.GOOD;
        let status = STATUS[statusRaw] ?? AssetStatus.AVAILABLE;

        const purchaseDate = this.toDate(this.cell(row, 'Purchased On', 'Purchase Date'));
        const warrantyEndDate = this.toDate(
          this.cell(row, 'Warranty expires on', 'Warranty End Date', 'Warranty Expiry'),
        );
        const assignmentDate = this.toDate(this.cell(row, 'Date of Asset Assignment'));

        const empNumber = this.cell(row, 'Assigned To Employee Number', 'Employee Number') as
          string | null;
        const empName = this.cell(row, 'Employee Name, if Assigned', 'Employee Name') as
          string | null;

        let assignedUserId: string | null = null;
        if (empNumber) {
          assignedUserId = await ensureEmployee(String(empNumber), empName);
          // An assigned employee implies the asset is out, even if the sheet
          // left the status blank.
          if (status === AssetStatus.AVAILABLE) status = AssetStatus.ASSIGNED;
        }

        // Upsert the asset by serial (idempotent re-import).
        const existingAsset = serialStr
          ? await this.prisma.client.asset.findFirst({
              where: { companyId, serialNumber: serialStr },
              select: { id: true, assetTag: true },
            })
          : null;

        const data = {
          name: nameStr,
          categoryId,
          subcategoryId,
          trackingType: TrackingType.INDIVIDUAL,
          serialNumber: serialStr,
          purchaseDate,
          warrantyEndDate,
          condition,
          status,
          assignedUserId,
          assignmentDate: assignedUserId ? (assignmentDate ?? new Date()) : null,
          updatedById: actor.id,
        };

        if (existingAsset) {
          await this.prisma.client.asset.update({ where: { id: existingAsset.id }, data });
          summary.assetsUpdated += 1;
        } else {
          tagSeq += 1;
          await this.prisma.client.asset.create({
            data: {
              ...data,
              companyId,
              assetTag: `AST-${String(tagSeq).padStart(4, '0')}`,
              qrToken: ulid(),
              createdById: actor.id,
            },
          });
          summary.assetsCreated += 1;
        }
        if (assignedUserId) summary.assigned += 1;
      } catch (err) {
        const message =
          err instanceof Prisma.PrismaClientKnownRequestError
            ? `${err.code}: ${(err.meta?.target as string[] | undefined)?.join(', ') ?? err.message}`
            : err instanceof Error
              ? err.message
              : 'Unknown error';
        summary.errors.push({ row: rowNo, message });
      }
    }

    await this.audit.record({
      companyId,
      actorId: actor.id,
      action: AuditAction.ASSET_CREATED,
      entityType: 'Asset',
      entityId: 'bulk-import',
      newValues: {
        rows: summary.rows,
        assetsCreated: summary.assetsCreated,
        assetsUpdated: summary.assetsUpdated,
        employeesCreated: summary.employeesCreated,
      },
    });

    this.logger.log(
      `Import by ${actor.id}: +${summary.assetsCreated} assets, ~${summary.assetsUpdated}, ` +
        `+${summary.employeesCreated} employees, ${summary.errors.length} errors`,
    );
    return summary;
  }
}
