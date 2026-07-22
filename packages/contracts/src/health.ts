import { z } from 'zod';

/** Liveness and readiness payloads consumed by Compose healthchecks and uptime probes. */

export const dependencyStatusSchema = z.enum(['up', 'down', 'degraded', 'mocked']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const dependencyHealthSchema = z.object({
  name: z.string(),
  status: dependencyStatusSchema,
  latencyMs: z.number().nonnegative().optional(),
  detail: z.string().optional(),
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
