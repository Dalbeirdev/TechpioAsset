import { z } from 'zod';

/** Liveness and readiness payloads consumed by Compose healthchecks and uptime probes. */

export const dependencyStatusSchema = z.enum(['up', 'down', 'degraded', 'mocked']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const dependencyHealthSchema = z.object({
  name: z.string(),
  status: dependencyStatusSchema,
  latencyMs: z.number().nonnegative().optional(),
  detail: z.string().optional(),
  /**
   * Whether the API can serve requests without this dependency. Only a failing
   * critical dependency makes the service `error`; a non-critical one degrades it.
   * Reported per dependency rather than assumed, so the distinction is visible to
   * whoever reads the probe rather than buried in the code.
   */
  critical: z.boolean().optional(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

/**
 * v2.8 S6 - "is this deployment actually protected?", answerable from outside
 * without credentials. Booleans and ages only: no tenant data, no counts, no
 * names. Reported because the honest answer has twice been "less than you
 * think" (RLS installed but dormant; backups on the same box as the database).
 */
export const protectionHealthSchema = z.object({
  /** True only if enforcement is configured AND the serving role cannot bypass it. */
  rlsEnforced: z.boolean(),
  rlsDetail: z.string().optional(),
  offsiteBackups: z.enum(['configured', 'not-configured', 'unreachable']),
  /** Age of the newest off-site copy, or null when there is none to speak of. */
  lastOffsiteBackupAgeHours: z.number().nonnegative().nullable(),
  offsiteDetail: z.string().optional(),
});
export type ProtectionHealth = z.infer<typeof protectionHealthSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.literal('techpioasset-api'),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  dependencies: z.array(dependencyHealthSchema),
  protection: protectionHealthSchema.optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
