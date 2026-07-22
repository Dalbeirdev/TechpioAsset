import { z } from 'zod';
import { pageMetaSchema, type PageMeta } from './pagination';

/**
 * Success envelope. Every 2xx body is `{ data, meta }` so clients never have to
 * guess whether a payload is bare or wrapped (spec section 24).
 */

export const responseMetaSchema = z.object({
  requestId: z.string(),
  timestamp: z.string().datetime(),
  page: pageMetaSchema.optional(),
  /**
   * Set when any part of this response came from a mock provider rather than the
   * real external service. Spec section 28: never silently pretend an external
   * call succeeded - the UI renders a visible "simulated" marker off this flag.
   */
  simulated: z.boolean().optional(),
});
export type ResponseMeta = z.infer<typeof responseMetaSchema>;

export function apiResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: responseMetaSchema });
}

export function apiListResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: responseMetaSchema.extend({ page: pageMetaSchema }),
  });
}

export interface ApiResponse<T> {
  data: T;
  meta: ResponseMeta;
}

export interface ApiListResponse<T> {
  data: T[];
  meta: ResponseMeta & { page: PageMeta };
}
