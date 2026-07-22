import { z } from 'zod';

/** Spec section 24: pagination, sorting and filtering on every collection endpoint. */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const sortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof sortOrderSchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Capped so a caller cannot turn a paginated endpoint into a full table scan.
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().min(1).optional(),
  order: sortOrderSchema.default('desc'),
  q: z.string().trim().min(1).max(200).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const pageMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalItems: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

export function buildPageMeta(input: {
  page: number;
  pageSize: number;
  totalItems: number;
}): PageMeta {
  const totalPages = Math.ceil(input.totalItems / input.pageSize);
  return {
    page: input.page,
    pageSize: input.pageSize,
    totalItems: input.totalItems,
    totalPages,
    hasNextPage: input.page < totalPages,
    hasPreviousPage: input.page > 1 && input.totalItems > 0,
  };
}
