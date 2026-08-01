import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** v2.4 Warehouse stock contracts: locations, guarded movements, conversion. */

const qty = z.number().positive().max(1_000_000);

export const createStockLocationSchema = z.object({
  code: z.string().trim().min(2).max(30).toUpperCase(),
  name: z.string().trim().min(2).max(120),
  officeId: z.string().optional().nullable(),
});
export type CreateStockLocationInput = z.infer<typeof createStockLocationSchema>;

export const updateStockLocationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    officeId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateStockLocationInput = z.infer<typeof updateStockLocationSchema>;

export const stockMovementQuerySchema = pageQuerySchema.extend({
  inventoryItemId: z.string().optional(),
  stockLocationId: z.string().optional(),
});
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;

const itemAtLocation = {
  inventoryItemId: z.string().min(1),
  stockLocationId: z.string().min(1),
};

export const issueStockSchema = z.object({
  ...itemAtLocation,
  quantity: qty,
  reason: z.string().trim().max(500).optional().nullable(),
});
export type IssueStockInput = z.infer<typeof issueStockSchema>;

export const adjustStockSchema = z.object({
  ...itemAtLocation,
  /** Positive adds stock, negative removes it. Zero is meaningless. */
  delta: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, {
    message: 'An adjustment of zero changes nothing',
  }),
  reason: z.string().trim().min(5, 'Say why - adjustments are audited').max(500),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const transferStockSchema = z
  .object({
    inventoryItemId: z.string().min(1),
    fromLocationId: z.string().min(1),
    toLocationId: z.string().min(1),
    quantity: qty,
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.fromLocationId !== v.toLocationId, {
    message: 'Source and destination must differ',
    path: ['toLocationId'],
  });
export type TransferStockInput = z.infer<typeof transferStockSchema>;

export const reserveStockSchema = z.object({
  ...itemAtLocation,
  quantity: qty,
});
export type ReserveStockInput = z.infer<typeof reserveStockSchema>;

export const countCorrectionSchema = z.object({
  ...itemAtLocation,
  countedQuantity: z.number().min(0).max(1_000_000),
  sessionId: z.string().optional().nullable(),
});
export type CountCorrectionInput = z.infer<typeof countCorrectionSchema>;

export const convertToAssetSchema = z.object({
  ...itemAtLocation,
  assetTag: z.string().trim().min(2).max(60),
  /** Defaults to the inventory item's name. */
  name: z.string().trim().min(2).max(200).optional().nullable(),
  serialNumber: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type ConvertToAssetInput = z.infer<typeof convertToAssetSchema>;
