import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/** The audit actions a reader can filter by (mirrors the Prisma AuditAction enum). */
export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_RESET',
  'MFA_ENROLLED',
  'MFA_DISABLED',
  'USER_CREATED',
  'USER_UPDATED',
  'ROLE_CHANGED',
  'PERMISSION_CHANGED',
  'ASSET_CREATED',
  'ASSET_UPDATED',
  'ASSET_STATUS_CHANGED',
  'ASSET_COST_CHANGED',
  'ASSIGNMENT_CREATED',
  'ASSIGNMENT_RETURNED',
  'ASSET_TRANSFERRED',
  'INVENTORY_ADJUSTED',
  'INVOICE_UPLOADED',
  'INVOICE_UPDATED',
  'INVOICE_ARCHIVED',
  'AI_PROCESSING',
  'AI_CORRECTION',
  'VERIFICATION_APPROVED',
  'VERIFICATION_REJECTED',
  'REQUEST_SUBMITTED',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'DISPOSAL_RECORDED',
  'DATA_EXPORTED',
  'SETTING_CHANGED',
  'DOCUMENT_DOWNLOADED',
] as const;
export type AuditActionName = (typeof AUDIT_ACTIONS)[number];

/** Read-only audit-log query: standard pagination plus append-only filters. */
export const auditQuerySchema = pageQuerySchema.extend({
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.string().trim().min(1).max(64).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  /** Inclusive lower / upper bounds on createdAt. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
