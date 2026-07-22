import { z } from 'zod';

/**
 * Error envelope, shaped after RFC 9457 (problem details).
 *
 * Spec section 24 requires consistent response structures, error codes and
 * request IDs. A machine-readable `code` sits alongside the RFC fields so the web
 * and mobile clients can branch without string-matching prose.
 */

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'MFA_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE_ASSET_TAG',
  'DUPLICATE_SERIAL_NUMBER',
  'DUPLICATE_INVOICE_NUMBER',
  'DUPLICATE_DOCUMENT',
  'ILLEGAL_STATE_TRANSITION',
  'CONCURRENT_MODIFICATION',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'FILE_REJECTED',
  'AI_DISABLED',
  'AI_PROVIDER_ERROR',
  'AUTOMATED_APPROVAL_FORBIDDEN',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const fieldErrorSchema = z.object({
  /** Dotted path into the request body, e.g. `lines.0.unitPrice`. */
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.enum(ERROR_CODES),
  requestId: z.string(),
  timestamp: z.string().datetime(),
  errors: z.array(fieldErrorSchema).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/** Default HTTP status per code, so handlers cannot drift from the contract. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  MFA_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_ASSET_TAG: 409,
  DUPLICATE_SERIAL_NUMBER: 409,
  DUPLICATE_INVOICE_NUMBER: 409,
  DUPLICATE_DOCUMENT: 409,
  ILLEGAL_STATE_TRANSITION: 409,
  CONCURRENT_MODIFICATION: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FILE_REJECTED: 400,
  AI_DISABLED: 409,
  AI_PROVIDER_ERROR: 502,
  AUTOMATED_APPROVAL_FORBIDDEN: 403,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};
