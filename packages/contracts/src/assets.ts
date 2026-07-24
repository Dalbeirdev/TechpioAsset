import { z } from 'zod';
import { ASSET_STATUSES, ASSET_CONDITIONS, TRACKING_TYPES } from '@techpioasset/domain';
import { moneyString } from './money.js';

/** Asset contracts (spec sections 5, 6, 12). */

export const assetStatusEnum = z.enum(ASSET_STATUSES);
export const assetConditionEnum = z.enum(ASSET_CONDITIONS);
export const trackingTypeEnum = z.enum(TRACKING_TYPES);

/** Money arrives as a string so it never round-trips through IEEE-754. */

const optionalDate = z.coerce.date().optional().nullable();

export const createAssetSchema = z.object({
  assetTag: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional().nullable(),
  trackingType: trackingTypeEnum.default('INDIVIDUAL'),

  brand: z.string().trim().max(120).optional().nullable(),
  model: z.string().trim().max(120).optional().nullable(),
  serialNumber: z.string().trim().max(120).optional().nullable(),
  manufacturerPartNumber: z.string().trim().max(120).optional().nullable(),
  barcode: z.string().trim().max(120).optional().nullable(),

  purchaseDate: optionalDate,
  purchaseCost: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  purchaseOrderNumber: z.string().trim().max(64).optional().nullable(),

  warrantyStartDate: optionalDate,
  warrantyEndDate: optionalDate,
  expectedReplacementDate: optionalDate,

  officeId: z.string().optional().nullable(),
  buildingId: z.string().optional().nullable(),
  floorId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),

  condition: assetConditionEnum.default('GOOD'),
  status: assetStatusEnum.default('DRAFT'),
  notes: z.string().trim().max(4000).optional().nullable(),

  /**
   * Required to create a second asset with an existing serial number. Spec
   * section 6 permits the duplicate only when an authorised user records a
   * documented exception, so the reason is the thing that unlocks it.
   */
  duplicateExceptionReason: z.string().trim().min(10).max(500).optional(),
});
export type CreateAssetInput = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = createAssetSchema.partial().extend({
  /** Optimistic-locking token; a stale value is rejected with 409. */
  version: z.number().int().nonnegative().optional(),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

/** Finance records a price once; the server locks it afterwards. */
export const setAssetPriceSchema = z.object({
  purchaseCost: moneyString,
  currency: z.string().length(3).toUpperCase().optional(),
});
export type SetAssetPriceInput = z.infer<typeof setAssetPriceSchema>;

export const assetListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().min(1).max(200).optional(),
  status: assetStatusEnum.optional(),
  categoryId: z.string().optional(),
  officeId: z.string().optional(),
  departmentId: z.string().optional(),
  assignedUserId: z.string().optional(),
  condition: assetConditionEnum.optional(),
  vendorId: z.string().optional(),
});
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;

export const assignAssetSchema = z.object({
  userId: z.string().min(1),
  expectedReturnAt: optionalDate,
  conditionOut: assetConditionEnum.default('GOOD'),
  accessoriesIssued: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type AssignAssetInput = z.infer<typeof assignAssetSchema>;

export const returnAssetSchema = z.object({
  conditionIn: assetConditionEnum,
  missingAccessories: z.string().trim().max(1000).optional().nullable(),
  damageNotes: z.string().trim().max(2000).optional().nullable(),
  /** Where the asset lands after return; constrained by the status machine. */
  resultingStatus: assetStatusEnum.default('AVAILABLE'),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type ReturnAssetInput = z.infer<typeof returnAssetSchema>;

export const changeAssetStatusSchema = z.object({
  status: assetStatusEnum,
  reason: z.string().trim().max(500).optional(),
});

/** Apply one status change to many assets at once (bulk action). */
export const bulkChangeStatusSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one asset').max(200),
  status: assetStatusEnum,
  reason: z.string().trim().max(500).optional(),
});
export type BulkChangeStatusInput = z.infer<typeof bulkChangeStatusSchema>;

/** Per-asset outcome of a bulk operation, so partial failures surface clearly. */
export interface BulkActionResult {
  succeeded: string[];
  failed: { id: string; reason: string }[];
}
