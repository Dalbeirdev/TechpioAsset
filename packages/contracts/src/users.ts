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
  /** Deactivated accounts live in their own view instead of padding the
   * default list with people who cannot sign in. */
  view: z.enum(['active', 'deactivated']).default('active'),
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

/**
 * v2.11 profile editing — two surfaces, deliberately different.
 *
 * Self-service covers what is YOURS to say: name, phone, job title. It stops
 * exactly where a field starts to drive access — department and office feed the
 * DEPARTMENT data scope, so letting a user move their own department would let
 * them choose whose assets they see.
 */
export const updateMyProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    displayName: z.string().trim().min(2).max(120).optional().nullable(),
    phone: z.string().trim().max(30).optional().nullable(),
    jobTitle: z.string().trim().max(120).optional().nullable(),
  })
  // Strict on purpose. Zod's default strips unknown keys, which turned a
  // self-service attempt to set departmentId into a 200 that silently ignored
  // it - the field feeds the data scope, and "refused with a reason" must never
  // degrade into "accepted and dropped".
  .strict();
export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

/**
 * Invite a new user (v2.12). The missing registration path: until now accounts
 * only arrived via platform provisioning or SCIM. Strict for the same reason
 * every other user-shaped schema is.
 */
export const inviteUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    jobTitle: z.string().trim().max(120).optional().nullable(),
    departmentId: z.string().optional().nullable(),
    officeId: z.string().optional().nullable(),
    /** Defaults to Registered Employee - least privilege unless the inviter says otherwise. */
    roleKeys: z.array(roleKey).min(1).default(['EMPLOYEE']),
  })
  .strict();
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** The admin surface adds the org-placement fields self-service must not touch. */
export const adminUpdateProfileSchema = updateMyProfileSchema.extend({
  departmentId: z.string().optional().nullable(),
  officeId: z.string().optional().nullable(),
  employeeNumber: z.string().trim().max(40).optional().nullable(),
});
export type AdminUpdateProfileInput = z.infer<typeof adminUpdateProfileSchema>;
