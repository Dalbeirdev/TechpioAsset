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

/**
 * v2.21 - departments were readable but never creatable: the model, the picker
 * on a person and the approval routing all existed, with no way to add one, so
 * the dropdown said "No department" forever.
 */
export const createDepartmentSchema = z.object({
  /** Short unique handle, e.g. ENG. Uppercased server-side. */
  code: trimmed(20),
  name: trimmed(120),
  /** Parent department, for a nested org structure. */
  parentId: z.string().min(1).optional().nullable(),
  /** Where the department mainly sits. */
  officeId: z.string().min(1).optional().nullable(),
  costCentre: optionalText(40),
  /** Who signs for it - feeds DEPARTMENT_HEAD approvals. */
  headId: z.string().min(1).optional().nullable(),
});
export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

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
