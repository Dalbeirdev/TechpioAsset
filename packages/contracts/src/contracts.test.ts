import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES, ERROR_STATUS, problemDetailsSchema } from './errors';
import { pageQuerySchema, buildPageMeta, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from './pagination';
import { apiResponseSchema, apiListResponseSchema } from './envelope';
import { healthResponseSchema } from './health';

describe('error contract', () => {
  it('maps every error code to an HTTP status', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code], `${code} has no status`).toBeGreaterThanOrEqual(100);
    }
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('keeps 4xx codes client-side and 5xx codes server-side', () => {
    expect(ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.VALIDATION_FAILED).toBe(422);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS.AI_PROVIDER_ERROR).toBe(502);
  });

  it('accepts a well-formed problem document', () => {
    const parsed = problemDetailsSchema.safeParse({
      type: 'https://techpioasset.dev/errors/forbidden',
      title: 'Forbidden',
      status: 403,
      code: 'FORBIDDEN',
      requestId: 'req_01H',
      timestamp: new Date('2026-07-22T10:00:00Z').toISOString(),
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an uncatalogued error code', () => {
    const parsed = problemDetailsSchema.safeParse({
      type: 'x',
      title: 'x',
      status: 400,
      code: 'MADE_UP',
      requestId: 'r',
      timestamp: new Date().toISOString(),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('pagination contract', () => {
  it('applies defaults for an empty query', () => {
    const parsed = pageQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parsed.order).toBe('desc');
  });

  it('coerces string query parameters', () => {
    expect(pageQuerySchema.parse({ page: '3', pageSize: '10' })).toMatchObject({
      page: 3,
      pageSize: 10,
    });
  });

  it('refuses a page size above the cap', () => {
    expect(pageQuerySchema.safeParse({ pageSize: MAX_PAGE_SIZE + 1 }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('computes page meta', () => {
    expect(buildPageMeta({ page: 2, pageSize: 25, totalItems: 60 })).toEqual({
      page: 2,
      pageSize: 25,
      totalItems: 60,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('handles an empty result set without claiming a previous page', () => {
    expect(buildPageMeta({ page: 1, pageSize: 25, totalItems: 0 })).toMatchObject({
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });

  it('reports no next page on the final page', () => {
    expect(buildPageMeta({ page: 3, pageSize: 25, totalItems: 60 }).hasNextPage).toBe(false);
  });
});

describe('response envelope', () => {
  const schema = apiResponseSchema(z.object({ id: z.string() }));

  it('requires requestId and timestamp on every response', () => {
    expect(
      schema.safeParse({
        data: { id: 'a' },
        meta: { requestId: 'r', timestamp: new Date().toISOString() },
      }).success,
    ).toBe(true);

    expect(schema.safeParse({ data: { id: 'a' }, meta: {} }).success).toBe(false);
  });

  it('carries the simulated flag for mock-provider responses', () => {
    const parsed = schema.parse({
      data: { id: 'a' },
      meta: { requestId: 'r', timestamp: new Date().toISOString(), simulated: true },
    });
    expect(parsed.meta.simulated).toBe(true);
  });

  it('requires page meta on list responses', () => {
    const list = apiListResponseSchema(z.object({ id: z.string() }));
    expect(
      list.safeParse({
        data: [],
        meta: { requestId: 'r', timestamp: new Date().toISOString() },
      }).success,
    ).toBe(false);
  });
});

describe('health contract', () => {
  it('accepts a mocked dependency status', () => {
    const parsed = healthResponseSchema.safeParse({
      status: 'ok',
      service: 'techpioasset-api',
      version: '0.1.0',
      environment: 'development',
      uptimeSeconds: 12,
      dependencies: [
        { name: 'postgres', status: 'up', latencyMs: 3 },
        { name: 'storage', status: 'mocked', detail: 'local filesystem provider' },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});
