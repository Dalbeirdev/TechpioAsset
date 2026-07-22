import { z } from 'zod';

/** Report contracts (spec section 18). */

export const REPORT_TYPES = [
  'ASSET_INVENTORY',
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
