import { z } from 'zod';

/**
 * Public demo-request form on pioassets.com (2026-08). Unauthenticated by
 * design; the API throttles it and the `website` field is a honeypot - humans
 * never see it, bots fill it, filled means silently discarded.
 */

export const DEMO_ASSET_COUNTS = ['UNDER_100', 'FROM_100_TO_500', 'FROM_500_TO_1000', 'OVER_1000'] as const;

export const demoRequestSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().email('Enter a valid business email').max(200),
  company: z.string().trim().min(2, 'Enter your company name').max(160),
  /**
   * Phone is required as of 2026-08: a lead we can only email is a lead that
   * waits on an inbox. Code and number are kept apart so the country is a
   * choice rather than something to remember to type.
   */
  phoneCountry: z
    .string()
    .trim()
    .regex(/^\+\d{1,4}$/, 'Choose a country code'),
  phone: z
    .string()
    .trim()
    .min(6, 'Enter your phone number')
    .max(20, 'That number looks too long')
    .regex(/^[\d\s()-]+$/, 'Digits, spaces and dashes only'),
  /** Optional so the About page's compact contact form shares this endpoint
   * without inventing values the visitor never chose. */
  assetCount: z.enum(DEMO_ASSET_COUNTS).optional(),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  /** Honeypot - must remain empty. */
  website: z.literal('').optional(),
});
export type DemoRequestInput = z.infer<typeof demoRequestSchema>;

/* v2.18 - notification engine admin (kept here to avoid a new barrel file). */
export const notificationRuleSchema = z.object({
  enabled: z.boolean(),
  notifyPrimary: z.boolean().default(true),
  recipientRoleKeys: z.array(z.string().max(64)).max(20).default([]),
  ccRoleKeys: z.array(z.string().max(64)).max(20).default([]),
  escalationRoleKeys: z.array(z.string().max(64)).max(20).default([]),
  thresholds: z.array(z.number().int().min(0).max(3650)).max(12).default([]),
});
export type NotificationRuleInput = z.infer<typeof notificationRuleSchema>;

export const emailTemplateSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  heading: z.string().trim().max(200).optional().nullable(),
  body: z.string().trim().min(3).max(5000),
  ctaLabel: z.string().trim().max(60).optional().nullable(),
  enabled: z.boolean().default(true),
});
export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;

export const emailLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['SENT', 'SIMULATED', 'FAILED']).optional(),
  type: z.string().max(64).optional(),
  q: z.string().trim().max(200).optional(),
});
export type EmailLogQuery = z.infer<typeof emailLogQuerySchema>;
