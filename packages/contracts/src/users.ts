import { z } from 'zod';
import { pageQuerySchema } from './pagination.js';

/**
 * Role keys are tenant role identifiers, not a fixed enum — custom roles
 * (v2.2 Workstream G) are addressed by key too. Existence and the read-only /
 * last-Super-Admin invariants are enforced server-side against the tenant's roles.
 */
const roleKey = z.string().trim().min(1).max(60);

/** Users list, with an optional role filter on top of the standard page query. */
export const userListQuerySchema = pageQuerySchema.extend({
  role: roleKey.optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** Replace a user's roles wholesale. Empty is rejected — everyone keeps at least one. */
export const setUserRolesSchema = z.object({
  roleKeys: z.array(roleKey).min(1, 'A user must keep at least one role'),
});
export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;

/**
 * Change a user's account status. INVITED is set by the invite flow, not here,
 * so an admin may only move a user between active and (de)activated states.
 */
export const setUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
  reason: z.string().trim().max(500).optional(),
});
export type SetUserStatusInput = z.infer<typeof setUserStatusSchema>;
