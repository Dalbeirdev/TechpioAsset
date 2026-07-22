import { z } from 'zod';
import { MAINTENANCE_STATUSES } from '@techpioasset/domain';

/** Maintenance contracts (spec section 14). */

const moneyString = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount with at most two decimal places');

export const maintenanceTypeEnum = z.enum([
  'SCHEDULED',
  'REPAIR',
  'INSPECTION',
  'WARRANTY_CLAIM',
  'CALIBRATION',
  'CLEANING',
]);

export const maintenanceStatusEnum = z.enum(MAINTENANCE_STATUSES);

export const createMaintenanceSchema = z.object({
  assetId: z.string().min(1),
  type: maintenanceTypeEnum,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  vendorId: z.string().optional().nullable(),
  isInternal: z.boolean().default(false),
  scheduledFor: z.coerce.date().optional().nullable(),
});
export type CreateMaintenanceInput = z.infer<typeof createMaintenanceSchema>;

export const completeMaintenanceSchema = z.object({
  serviceCost: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  downtimeHours: z
    .string()
    .regex(/^\d{1,6}(\.\d{1,2})?$/)
    .optional()
    .nullable(),
  resolutionNotes: z.string().trim().max(2000).optional().nullable(),
  replacementRecommended: z.boolean().default(false),
  recommendationNote: z.string().trim().max(1000).optional().nullable(),
  /** Whether completing this returns the asset to service or leaves it retired. */
  restoreAsset: z.boolean().default(true),
});

export const scheduleMaintenanceSchema = z.object({
  scheduledFor: z.coerce.date(),
});

export const maintenanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  order: z.enum(['asc', 'desc']).default('desc'),
  status: maintenanceStatusEnum.optional(),
  assetId: z.string().optional(),
  type: maintenanceTypeEnum.optional(),
});
export type MaintenanceListQuery = z.infer<typeof maintenanceListQuerySchema>;
