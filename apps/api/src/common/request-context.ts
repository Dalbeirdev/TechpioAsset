import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request ambient context.
 *
 * Tenancy and provenance must reach the persistence layer without being threaded
 * through every service signature - if they were parameters, one forgotten
 * argument would silently produce a cross-tenant query. AsyncLocalStorage makes
 * omission impossible instead of merely discouraged.
 */
export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  /** Absent until the JWT guard runs, and on public routes. */
  readonly userId?: string;
  readonly companyId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly clientType?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireCompanyId(): string {
  const companyId = storage.getStore()?.companyId;
  if (!companyId) {
    throw new Error(
      'No tenant in request context. A tenant-scoped query ran outside an authenticated request.',
    );
  }
  return companyId;
}

/**
 * Widen the context once authentication has resolved the actor. Returns a new
 * object; the store is replaced rather than mutated so concurrent reads stay safe.
 */
export function withActor(patch: Partial<RequestContext>): RequestContext {
  const current = storage.getStore();
  if (!current) throw new Error('withActor called outside a request context');
  const next = { ...current, ...patch };
  storage.enterWith(next);
  return next;
}
