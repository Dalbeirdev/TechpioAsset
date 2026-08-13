import { z } from 'zod';

/**
 * Public demo-request form on pioassets.com (2026-08). Unauthenticated by
 * design; the API throttles it and the `website` field is a honeypot - humans
 * never see it, bots fill it, filled means silently discarded.
 */

export const DEMO_ASSET_COUNTS = ['UNDER_100', 'FROM_100_TO_500', 'FROM_500_TO_1000', 'OVER_1000'] as const;
export const DEMO_INTERESTS = [
  'ASSET_MANAGEMENT',
  'HARDWARE_TRACKING',
  'WARRANTY_MANAGEMENT',
  'SOFTWARE_LICENSES',
  'IT_INVENTORY',
  'OTHER',
] as const;

export const demoRequestSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().email('Enter a valid business email').max(200),
  company: z.string().trim().min(2, 'Enter your company name').max(160),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  assetCount: z.enum(DEMO_ASSET_COUNTS),
  interest: z.enum(DEMO_INTERESTS),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  /** Honeypot - must remain empty. */
  website: z.literal('').optional(),
});
export type DemoRequestInput = z.infer<typeof demoRequestSchema>;
