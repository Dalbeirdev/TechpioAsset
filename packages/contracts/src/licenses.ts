import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * v2.3 License Management contracts. Money uses the same string-decimal shape
 * as assets/invoices; catalogue membership of enum-ish fields lives in
 * @techpioasset/domain and Prisma — these schemas stay pure shapes.
 */

const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a plain amount like 1499.00')
  .optional()
  .nullable();

const licenseFamilyEnum = z.enum([
  'PRODUCTIVITY_SUITE',
  'OPERATING_SYSTEM',
  'SECURITY',
  'DEVELOPER_TOOLS',
  'DESIGN_CREATIVE',
  'SAAS',
  'DATABASE_SERVER',
  'OTHER',
]);
const subscriptionTypeEnum = z.enum(['PERPETUAL', 'SUBSCRIPTION', 'OEM', 'VOLUME', 'OPEN']);
const licenseUnitEnum = z.enum(['USER', 'DEVICE']);
const costModelEnum = z.enum(['PER_SEAT', 'FLAT', 'PER_CPU', 'PER_CORE']);

export const licenseListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'RETIRED']).optional(),
  family: licenseFamilyEnum.optional(),
  vendorId: z.string().optional(),
});
export type LicenseListQuery = z.infer<typeof licenseListQuerySchema>;

export const createLicenseSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the licence').max(200),
    family: licenseFamilyEnum,
    subscriptionType: subscriptionTypeEnum,
    edition: z.string().trim().max(120).optional().nullable(),
    vendorId: z.string().optional().nullable(),
    purchaseDate: z.coerce.date(),
    expiryDate: z.coerce.date().optional().nullable(),
    renewalDate: z.coerce.date().optional().nullable(),
    autoRenewal: z.boolean().optional().default(false),
    seatsPurchased: z.number().int().min(0).max(1_000_000),
    unitOfAssignment: licenseUnitEnum,
    costAmount: moneyString,
    costCurrency: z.string().trim().length(3).optional().nullable(),
    costModel: costModelEnum.optional().default('PER_SEAT'),
    invoiceId: z.string().optional().nullable(),
    purchaseOrderNumber: z.string().trim().max(80).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => v.subscriptionType === 'PERPETUAL' || v.expiryDate, {
    message: 'Non-perpetual licences need an expiry date',
    path: ['expiryDate'],
  });
export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;

/** seatsPurchased changes only via renewals; expiry via renewals or here. */
export const updateLicenseSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  edition: z.string().trim().max(120).nullable().optional(),
  vendorId: z.string().nullable().optional(),
  renewalDate: z.coerce.date().nullable().optional(),
  autoRenewal: z.boolean().optional(),
  costAmount: moneyString,
  costCurrency: z.string().trim().length(3).nullable().optional(),
  costModel: costModelEnum.optional(),
  purchaseOrderNumber: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  retired: z.boolean().optional(),
});
export type UpdateLicenseInput = z.infer<typeof updateLicenseSchema>;

export const assignSeatSchema = z.object({
  userId: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});
export type AssignSeatInput = z.infer<typeof assignSeatSchema>;

export const revokeSeatSchema = z.object({
  assignmentId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
});
export type RevokeSeatInput = z.infer<typeof revokeSeatSchema>;

export const createRenewalSchema = z
  .object({
    newExpiry: z.coerce.date().optional().nullable(),
    seatsDelta: z.number().int().min(-1_000_000).max(1_000_000).optional().default(0),
    costAmount: moneyString,
    costCurrency: z.string().trim().length(3).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => v.newExpiry || (v.seatsDelta ?? 0) !== 0, {
    message: 'A renewal must extend the expiry, change the seat count, or both',
  });
export type CreateRenewalInput = z.infer<typeof createRenewalSchema>;

export const addLicenseKeySchema = z.object({
  key: z.string().trim().min(4, 'Paste the licence key').max(4000),
  note: z.string().trim().max(500).optional().nullable(),
});
export type AddLicenseKeyInput = z.infer<typeof addLicenseKeySchema>;
