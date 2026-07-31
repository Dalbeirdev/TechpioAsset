import { z } from 'zod';

/**
 * v2.2 Workstream G — runtime custom-role management contracts.
 *
 * `permissions` are `resource:action` keys; membership in the catalogue and the
 * read-only invariant are enforced in the service against @techpioasset/domain,
 * not here, so the contract stays a pure shape.
 */

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name').max(60),
  description: z.string().trim().max(280).optional().nullable(),
  isReadOnly: z.boolean().optional().default(false),
  permissions: z.array(z.string().min(1)).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    description: z.string().trim().max(280).nullable().optional(),
    permissions: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.permissions !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
