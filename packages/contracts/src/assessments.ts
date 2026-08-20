import { z } from 'zod';
import { moneyString } from './money';

/**
 * The commercial assessment of a request (v2.25).
 *
 * An employee states a requirement; they never state a price. Everything here
 * is entered afterwards by somebody holding `requests:assess` - Office Admin,
 * Finance, or an admin - and it is this figure, never the requester's, that
 * decides whether Finance has to review the spend.
 *
 * `totalCost` is deliberately absent from the input: it is computed from the
 * parts on every write. A number that routes a request must not be assertable
 * by the caller, or the arithmetic becomes a suggestion.
 */
export const upsertAssessmentSchema = z
  .object({
    inventoryAvailable: z.boolean().nullable().optional(),
    /** The specific asset found on the shelf, when one was. */
    suitableAssetId: z.string().nullable().optional(),
    /** False means no new expenditure - Finance is skipped for that reason. */
    purchaseRequired: z.boolean().nullable().optional(),

    suggestedProduct: z.string().trim().max(200).nullable().optional(),
    vendorId: z.string().nullable().optional(),

    unitPrice: moneyString.nullable().optional(),
    quantity: z.number().int().min(1).max(100_000).nullable().optional(),
    taxAmount: moneyString.nullable().optional(),
    shipping: moneyString.nullable().optional(),
    discount: moneyString.nullable().optional(),

    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to record');

export type UpsertAssessmentInput = z.infer<typeof upsertAssessmentSchema>;

export const assessmentSchema = z.object({
  id: z.string(),
  inventoryAvailable: z.boolean().nullable(),
  suitableAsset: z
    .object({ id: z.string(), assetTag: z.string(), name: z.string() })
    .nullable(),
  purchaseRequired: z.boolean().nullable(),
  suggestedProduct: z.string().nullable(),
  vendor: z.object({ id: z.string(), name: z.string() }).nullable(),
  unitPrice: z.string().nullable(),
  quantity: z.number().nullable(),
  taxAmount: z.string().nullable(),
  shipping: z.string().nullable(),
  discount: z.string().nullable(),
  /** Computed server-side: (unitPrice x quantity) + tax + shipping - discount. */
  totalCost: z.string().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  assessedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  assessedAt: z.string().nullable(),
});

export type RequestAssessment = z.infer<typeof assessmentSchema>;
