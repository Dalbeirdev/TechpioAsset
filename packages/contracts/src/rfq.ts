import { z } from 'zod';

/** v2.9 C3 contracts: request quotes, record responses, award one with a reason. */

const money = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a plain amount like 199.00');

export const createRfqSchema = z.object({
  vendorIds: z
    .array(z.string().min(1))
    .min(2, 'Ask at least two vendors - one quote is not a comparison')
    .max(20),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export type CreateRfqInput = z.infer<typeof createRfqSchema>;

export const recordQuoteSchema = z.object({
  /// The vendor's own quote reference, so paper can be matched to this row.
  reference: z.string().trim().max(100).optional().nullable(),
  currency: z.string().trim().length(3),
  leadTimeDays: z.number().int().min(0).max(3650).optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        purchaseRequestLineId: z.string().optional().nullable(),
        description: z.string().trim().min(2).max(500),
        quantity: z.number().positive().max(1_000_000),
        unitPrice: money,
      }),
    )
    .min(1, 'A quote needs at least one line'),
});
export type RecordQuoteInput = z.infer<typeof recordQuoteSchema>;

export const declineQuoteSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});
export type DeclineQuoteInput = z.infer<typeof declineQuoteSchema>;

export const awardQuoteSchema = z.object({
  quoteId: z.string().min(1),
  /**
   * Required, and deliberately not a dropdown: the whole value of the record is
   * that somebody wrote down why this vendor at this price.
   */
  reason: z
    .string()
    .trim()
    .min(10, 'Say why this quote won - at least 10 characters')
    .max(1000),
});
export type AwardQuoteInput = z.infer<typeof awardQuoteSchema>;
