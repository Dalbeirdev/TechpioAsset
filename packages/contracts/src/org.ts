import { z } from 'zod';

/**
 * Office writes (v2.11). Offices were seed-only reference data until now —
 * readable everywhere, creatable nowhere. These schemas are `.strict()` for the
 * same reason the profile ones are: an unknown key silently stripped is a
 * request that lies about what it did.
 */

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const createOfficeSchema = z
  .object({
    /** Short unique handle, e.g. BLR-HQ. Uppercased server-side. */
    code: trimmed(20),
    name: trimmed(120),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    city: optionalText(80),
    region: optionalText(80),
    postalCode: optionalText(20),
    country: optionalText(80),
    /** IANA name, e.g. Asia/Kolkata. Free text on purpose — validating the
     * full IANA set here would go stale; a wrong value only affects display. */
    timezone: optionalText(60),
  })
  .strict();

export const updateOfficeSchema = createOfficeSchema
  .partial()
  .extend({
    /** Deactivating hides the office from pickers without unlinking anyone. */
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateOfficeInput = z.infer<typeof createOfficeSchema>;
export type UpdateOfficeInput = z.infer<typeof updateOfficeSchema>;
