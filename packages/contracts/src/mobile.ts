import { z } from 'zod';

/** Mobile synchronisation contracts (spec sections 16, 24). */

export const registerDeviceSchema = z.object({
  token: z.string().min(1).max(255),
  platform: z.enum(['ios', 'android']),
  deviceName: z.string().trim().max(120).optional(),
});

/** One queued offline operation uploaded for replay. */
export const offlineOperationSchema = z.object({
  clientGeneratedId: z.string().min(8).max(64),
  type: z.enum(['INVENTORY_SCAN', 'CONDITION_UPDATE', 'ASSET_PHOTO', 'LOCATION_UPDATE', 'NOTE']),
  entityId: z.string().nullable(),
  capturedAt: z.string().datetime(),
  baseVersion: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const syncBatchSchema = z.object({
  /** The physical-inventory session these scans belong to, when applicable. */
  sessionId: z.string().optional(),
  operations: z.array(offlineOperationSchema).min(1).max(500),
});
export type SyncBatchInput = z.infer<typeof syncBatchSchema>;

export const startInventorySessionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  officeId: z.string().optional(),
});

/** Delta pull: assets changed since a timestamp, so the device refreshes cheaply. */
export const deltaQuerySchema = z.object({
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
