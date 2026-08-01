import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** v2.4 Procurement contracts: PR lifecycle, PO issue/convert, GRN receive. */

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a plain amount like 199.00');

const qty = z.number().positive().max(1_000_000);

export const prListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED']).optional(),
  mine: z.coerce.boolean().optional(),
});
export type PrListQuery = z.infer<typeof prListQuerySchema>;

export const createPurchaseRequestSchema = z.object({
  justification: z
    .string()
    .trim()
    .min(10, 'At least 10 characters - approvers read this first.')
    .max(2000),
  neededBy: z.coerce
    .date()
    .refine((d) => d.getTime() >= new Date(new Date().toDateString()).getTime(), {
      message: 'The needed-by date cannot be in the past',
    })
    .optional()
    .nullable(),
  currency: z.string().trim().length(3).optional().nullable(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(2).max(500),
        quantity: qty,
        estimatedUnitPrice: money.optional().nullable(),
        inventoryItemId: z.string().optional().nullable(),
      }),
    )
    .min(1, 'Add at least one line'),
});
export type CreatePurchaseRequestInput = z.infer<typeof createPurchaseRequestSchema>;

export const decidePurchaseRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(1000).optional().nullable(),
});
export type DecidePurchaseRequestInput = z.infer<typeof decidePurchaseRequestSchema>;

export const convertPurchaseRequestSchema = z.object({
  vendorId: z.string().min(1, 'Pick the vendor the order goes to'),
  currency: z.string().trim().length(3).optional().nullable(),
});
export type ConvertPurchaseRequestInput = z.infer<typeof convertPurchaseRequestSchema>;

export const receiveGrnSchema = z.object({
  notes: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().min(1),
        quantity: qty,
        intake: z.enum(['STOCK', 'ASSET']),
        /// STOCK intake must say where and as which item.
        stockLocationId: z.string().optional().nullable(),
        inventoryItemId: z.string().optional().nullable(),
        note: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1, 'Receive at least one line'),
});
export type ReceiveGrnInput = z.infer<typeof receiveGrnSchema>;
