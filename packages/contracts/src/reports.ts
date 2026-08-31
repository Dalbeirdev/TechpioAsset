import { z } from 'zod';

/** Report contracts (spec section 18). */

export const REPORT_TYPES = [
  'ASSET_INVENTORY',
  /**
   * One row per person, every item they hold on that row (v2.28).
   *
   * The inventory report answers "what do we own"; this answers "what is
   * Deepak holding", which is the question asked at an audit, an exit
   * interview and a handover. Getting it out of the inventory sheet meant
   * sorting by holder and reading eight consecutive rows as one - so the
   * consolidation now happens in the report rather than in the reader's head.
   */
  'EMPLOYEE_ASSETS',
  'SPENDING_BY_VENDOR',
  'SPENDING_BY_CATEGORY',
  'SPENDING_BY_DEPARTMENT',
  'DEPRECIATION',
  'WARRANTY_EXPIRY',
  'MAINTENANCE_COST',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportFormatEnum = z.enum(['JSON', 'CSV', 'XLSX']);
export type ReportFormat = z.infer<typeof reportFormatEnum>;

export const reportQuerySchema = z.object({
  type: z.enum(REPORT_TYPES),
  format: reportFormatEnum.default('JSON'),
  officeId: z.string().optional(),
  departmentId: z.string().optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export const createScheduledReportSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(REPORT_TYPES),
  format: reportFormatEnum.default('CSV'),
  /** Standard 5-field cron, evaluated in the company timezone. */
  cron: z.string().trim().min(9).max(100),
  recipients: z.array(z.string().email()).min(1).max(50),
});
