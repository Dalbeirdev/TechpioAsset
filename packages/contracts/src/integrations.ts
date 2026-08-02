import { z } from 'zod';

/**
 * v2.6 A3 - integrations hub contracts. The webhook event catalogue is the
 * closed set of things the platform actually emits; a subscription cannot
 * name an event that will never fire.
 */

export const WEBHOOK_EVENTS = [
  'asset.created',
  'request.decided',
  'license.seat_blocked',
  'workorder.escalated',
  'discovery.conflict',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const createWebhookSchema = z.object({
  url: z.string().url().max(500).refine((u) => u.startsWith('https://') || u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1'), {
    message: 'Webhook URLs must be https (localhost allowed for development)',
  }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

export const updateWebhookSchema = z.object({
  url: createWebhookSchema.shape.url.optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

/** SCIM 2.0 user resource, the subset the provisioning endpoint honours. */
export const scimUserSchema = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().email(),
  name: z
    .object({
      givenName: z.string().max(100).optional(),
      familyName: z.string().max(100).optional(),
    })
    .optional(),
  active: z.boolean().default(true),
  roles: z.array(z.object({ value: z.string() })).optional(),
});
export type ScimUserInput = z.infer<typeof scimUserSchema>;

export const scimPatchSchema = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z
    .array(
      z.object({
        op: z.string(),
        path: z.string().optional(),
        value: z.unknown(),
      }),
    )
    .min(1),
});
export type ScimPatchInput = z.infer<typeof scimPatchSchema>;
