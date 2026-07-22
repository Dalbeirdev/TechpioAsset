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

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.literal('techpioasset-api'),
  version: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  dependencies: z.array(dependencyHealthSchema),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
