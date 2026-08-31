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
import {
  toCsv,
  csvHeaderLine,
  csvRowLine,
  REPORT_CONTENT_TYPE,
  REPORT_EXTENSION,
} from './report-format.js';
import { buildWorkbook } from './report-workbook.js';

/** Rows fetched, written and released per iteration. */
const EXPORT_PAGE = 5_000;

/**
 * Write one chunk, honouring backpressure.
 *
 * `res.write` returning false means Node has buffered the chunk because the
 * socket is not draining. Ignoring that turns "streaming" into "buffering in a
 * different place, invisibly" — measured at 113 MB peak heap for a 5.8 MB
 * download, worse than the buffered version it replaced.
 */
function write(res: Response, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (res.write(chunk)) {
      resolve();
      return;
    }
    res.once('drain', resolve);
    res.once('error', reject);
  });
}

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
    const filters = { officeId: query.officeId, departmentId: query.departmentId };

    if (query.format === 'JSON') {
      return this.reports.build(actor, query.type, filters);
    }

    // Export path requires the export permission on top of read. Checked before
    // any row is fetched, so a refusal costs nothing.
    if (!actor.permissions.includes(PERMISSIONS.REPORTS_EXPORT)) {
      res.status(403);
      return { code: 'FORBIDDEN', title: 'You may not export reports' };
    }

    const filename = `${query.type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${REPORT_EXTENSION[query.format]}`;

    // v2.28 — XLSX is a branded workbook and therefore buffered.
    //
    // ExcelJS's streaming writer has no `worksheet.addImage` at all, so a logo
    // and a streamed workbook cannot coexist. Rather than lose either, the two
    // formats took different jobs: XLSX is a presentation document for people,
    // capped at MAX_WORKBOOK_ROWS; CSV stays the unbounded bulk format and is
    // still streamed a page at a time below. The cap is what keeps the old
    // 98.6 MB export incident from returning through this door.
    if (query.format === 'XLSX') {
      const table = await this.reports.build(actor, query.type, filters);
      const header = await this.reports.workbookHeader(actor, filters);

      let file: Buffer;
      try {
        file = await buildWorkbook(
          { ...header, reportTitle: table.title, generatedAt: new Date() },
          table.columns,
          table.rows,
        );
      } catch (error) {
        // Over the cap. A 400 naming CSV is more use than a generic failure,
        // and far more use than an out-of-memory ten seconds later.
        res.status(400);
        return {
          code: 'VALIDATION_FAILED',
          title: error instanceof Error ? error.message : 'This report is too large for Excel',
        };
      }

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
        'Content-Type': REPORT_CONTENT_TYPE.XLSX,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(file.length),
        'Cache-Control': 'private, no-store',
      });
      res.end(file);
      return undefined;
    }

    // v2.10 S5 — the row-per-record reports are written a page at a time.
    //
    // Buffering a 100,000-row export held four copies of every row at once:
    // the Prisma objects, the mapped rows, the formatted lines and the joined
    // string. A 5.8 MB download cost 98.6 MB of heap. Streaming holds one page.
    const spec = this.reports.streamSpec(actor, query.type, filters);
    if (spec) {
      res.set({
        'Content-Type': REPORT_CONTENT_TYPE[query.format],
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      });

      // CSV only: XLSX returned above. The format branch that used to live here
      // is gone rather than left unreachable.
      await write(res, csvHeaderLine(spec.columns));

      let rows = 0;
      for (let skip = 0; ; skip += EXPORT_PAGE) {
        const page = await spec.page(skip, EXPORT_PAGE);
        // One write per page, not per row. 100,000 individual writes queue in
        // Node's internal buffer far faster than a socket drains them, which is
        // how the first version of this used MORE memory than buffering did.
        await write(res, page.map((row) => `\r\n${csvRowLine(spec.columns, row)}`).join(''));
        rows += page.length;
        if (page.length < EXPORT_PAGE) break;
      }

      // Audited AFTER the rows are written, with the count that actually left.
      // Recording an intended row count before streaming would log an export
      // that a mid-stream failure never completed.
      await this.audit.record({
        companyId: actor.companyId,
        actorId: actor.id,
        action: AuditAction.REPORT_EXPORTED,
        entityType: 'Report',
        entityId: query.type,
        newValues: {
          format: query.format,
          rows,
          delivery: 'DOWNLOAD',
          filters: { officeId: query.officeId ?? null, departmentId: query.departmentId ?? null },
        },
      });
      res.end();
      return undefined;
    }

    // The aggregate reports return one row per vendor or category; buffering a
    // dozen rows needs no machinery.
    const table = await this.reports.build(actor, query.type, filters);
    const body = toCsv(table);

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
