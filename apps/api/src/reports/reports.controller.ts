import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditAction } from '@prisma/client';
import type { Response } from 'express';
import { reportQuerySchema, type AuthUser, type ReportQuery } from '@techpioasset/contracts';
import { PERMISSIONS } from '@techpioasset/domain';
import { zodBody } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { ReportsService } from './reports.service.js';
import { toCsv, toSpreadsheetMl, REPORT_CONTENT_TYPE, REPORT_EXTENSION } from './report-format.js';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ApiOperation({
    summary: 'Generate a report',
    description:
      'JSON by default; format=CSV or XLSX streams a download. Financial reports require ' +
      'assets:cost:read (spec section 18: permission-based financial columns).',
  })
  async generate(
    @CurrentUser() actor: AuthUser,
    @Query(zodBody(reportQuerySchema)) query: ReportQuery,
    @Res({ passthrough: true }) res: Response,
  ) {
    const table = await this.reports.build(actor, query.type, {
      officeId: query.officeId,
      departmentId: query.departmentId,
    });

    if (query.format === 'JSON') {
      return table;
    }

    // Export path requires the export permission on top of read.
    if (!actor.permissions.includes(PERMISSIONS.REPORTS_EXPORT)) {
      res.status(403);
      return { code: 'FORBIDDEN', title: 'You may not export reports' };
    }

    const body = query.format === 'CSV' ? toCsv(table) : toSpreadsheetMl(table);
    const filename = `${query.type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${REPORT_EXTENSION[query.format]}`;

    // v2.7 R2 (AUD-009): data leaving the system is an auditable event. Who
    // took what, in which shape, when - financial reports especially.
    await this.audit.record({
      companyId: actor.companyId,
      actorId: actor.id,
      action: AuditAction.REPORT_EXPORTED,
      entityType: 'Report',
      entityId: query.type,
      newValues: {
        format: query.format,
        rows: table.rows.length,
        delivery: 'DOWNLOAD',
        filters: { officeId: query.officeId ?? null, departmentId: query.departmentId ?? null },
      },
    });

    res.set({
      'Content-Type': REPORT_CONTENT_TYPE[query.format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    });
    return body;
  }
}
