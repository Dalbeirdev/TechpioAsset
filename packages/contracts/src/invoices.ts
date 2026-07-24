import { z } from 'zod';
import { moneyString } from './money.js';

/** Invoice contracts (spec sections 8, 9). */

export const invoiceLineInputSchema = z.object({
  lineNumber: z.number().int().positive(),
  description: z.string().trim().min(1).max(500),
  quantity: z.union([z.string(), z.number()]).transform((v) => String(v)),
  unitPrice: moneyString,
  lineTotal: moneyString,
  serialNumbers: z.array(z.string().trim().min(1)).optional(),
  warrantyMonths: z.number().int().min(0).max(600).optional(),
});

/** Manual invoice entry — the AI-disabled path must remain fully usable. */
export const createInvoiceSchema = z.object({
  vendorId: z.string().min(1),
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.coerce.date(),
  purchaseDate: z.coerce.date().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  currency: z.string().length(3).toUpperCase(),
  subtotal: moneyString,
  discount: moneyString.optional().default('0.00'),
  tax: moneyString.optional().default('0.00'),
  shipping: moneyString.optional().default('0.00'),
  otherCharges: moneyString.optional().default('0.00'),
  total: moneyString,
  paymentStatus: z
    .enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DISPUTED', 'CANCELLED'])
    .default('UNPAID'),
  purchaseOrderNumber: z.string().trim().max(64).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  lines: z.array(invoiceLineInputSchema).min(1, 'Add at least one line').max(200),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

/** Correcting AI-extracted fields before verification (spec section 9 step 8). */
export const correctExtractionSchema = z.object({
  vendorId: z.string().optional(),
  invoiceNumber: z.string().trim().min(1).max(100).optional(),
  invoiceDate: z.coerce.date().optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  subtotal: moneyString.optional(),
  discount: moneyString.optional(),
  tax: moneyString.optional(),
  shipping: moneyString.optional(),
  total: moneyString.optional(),
  lines: z.array(invoiceLineInputSchema).optional(),
});

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().min(1).max(200).optional(),
  verificationStatus: z.string().optional(),
  vendorId: z.string().optional(),
  paymentStatus: z.string().optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/** Final human decision (spec section 9 step 13). */
export const verifyInvoiceDecisionSchema = z.object({
  decision: z.enum(['VERIFIED', 'REJECTED']),
  notes: z.string().trim().max(2000).optional(),
});

/** Link an invoice line to an asset or inventory record (spec section 8). */
export const linkInvoiceLineSchema = z.object({
  lineId: z.string().min(1),
  assetId: z.string().optional(),
  inventoryItemId: z.string().optional(),
});

/** Super Admin AI configuration (spec section 10). */
export const updateAiConfigSchema = z.object({
  globallyEnabled: z.boolean().optional(),
  paused: z.boolean().optional(),
  featureModes: z
    .record(
      z.string(),
      z.enum([
        'DISABLED',
        'SUGGESTION_ONLY',
        'MANUAL_REVIEW_REQUIRED',
        'AUTOMATIC_PROCESSING',
        'RESTRICTED_TO_ROLES',
      ]),
    )
    .optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  monthlyBudgetUsd: z.number().min(0).optional().nullable(),
  monthlyRequestLimit: z.number().int().min(0).optional().nullable(),
  humanReviewRequired: z.boolean().optional(),
});
