import { z } from 'zod';
import { REQUEST_STATUSES } from '@techpioasset/domain';

/** Request contracts (spec section 11). */

export const REQUEST_TYPES = [
  'NEW_EMPLOYEE_ONBOARDING',
  'REPLACEMENT',
  'DAMAGE',
  'LOSS',
  'UPGRADE',
  'TEMPORARY_ASSIGNMENT',
  'PROJECT_REQUIREMENT',
  'OFFICE_REQUIREMENT',
  'KITCHEN_REQUIREMENT',
  'ACCESSIBILITY_REQUIREMENT',
  'ADDITIONAL_EQUIPMENT',
  'REPAIR',
  'RETURN',
] as const;

export const requestTypeEnum = z.enum(REQUEST_TYPES);
export const requestStatusEnum = z.enum(REQUEST_STATUSES);
export const requestPriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const moneyString = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount with at most two decimal places');

export const requestItemSchema = z.object({
  categoryId: z.string().optional().nullable(),
  subcategoryId: z.string().optional().nullable(),
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().positive().max(9999).default(1),
  preferredSpec: z.string().trim().max(1000).optional().nullable(),
  estimatedCost: moneyString.optional().nullable(),
});

export const createRequestSchema = z.object({
  type: requestTypeEnum,
  priority: requestPriorityEnum.default('NORMAL'),
  /** HR and similar roles raise requests for someone else; needs requests:create-on-behalf. */
  beneficiaryId: z.string().optional().nullable(),
  businessReason: z.string().trim().min(10, 'Explain why this is needed').max(2000),
  requiredBy: z.coerce.date().optional().nullable(),
  preferredSpec: z.string().trim().max(1000).optional().nullable(),
  isReplacement: z.boolean().default(false),
  replacesAssetId: z.string().optional().nullable(),
  estimatedCost: moneyString.optional().nullable(),
  currency: z.string().length(3).toUpperCase().optional().nullable(),
  officeId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  items: z.array(requestItemSchema).min(1, 'Add at least one item').max(50),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const requestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  q: z.string().trim().min(1).max(200).optional(),
  status: requestStatusEnum.optional(),
  type: requestTypeEnum.optional(),
  /** Only requests currently awaiting the caller's decision. */
  awaitingMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type RequestListQuery = z.infer<typeof requestListQuerySchema>;

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(2000).optional(),
});

export const requestCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  /** Internal comments are hidden from the requesting employee. */
  isInternal: z.boolean().default(false),
});

export const fulfilRequestSchema = z.object({
  /** Asset to hand over; must be assignable. */
  assetId: z.string().min(1),
  requestItemId: z.string().optional(),
  expectedReturnAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
