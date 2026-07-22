import type { ProblemDetails } from '@techpioasset/contracts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const BASE = `${API_URL}/api/v1`;

export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly status: number,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.problem.code;
  }

  /** Field-level messages keyed by dotted path, for form binding. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const error of this.problem.errors ?? []) map[error.path] = error.message;
    return map;
  }
}

/**
 * The access token lives in a module-level variable, never in localStorage.
 *
 * localStorage is readable by any script on the page, so an XSS flaw there
 * exports a working credential. In memory it dies with the tab, and the refresh
 * token that rebuilds the session is an httpOnly cookie no script can read.
 */
let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Internal: prevents a refresh loop when the refresh call itself 401s. */
  skipRefresh?: boolean;
}

async function parseProblem(response: Response): Promise<ProblemDetails> {
  try {
    return (await response.json()) as ProblemDetails;
  } catch {
    return {
      type: 'about:blank',
      title: response.statusText || 'Request failed',
      status: response.status,
      code: 'INTERNAL_ERROR',
      requestId: 'unknown',
      timestamp: new Date().toISOString(),
    };
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the session, de-duplicating concurrent attempts.
 *
 * Without the shared promise, a page issuing several queries at once would fire
 * one refresh per request. Refresh tokens rotate on use, so the second would
 * present an already-rotated token, be treated as replay, and revoke the whole
 * family - logging the user out for doing nothing wrong.
 */
async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { data: { accessToken: string } };
      accessToken = payload.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all observe
      // the same result before a new attempt can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipRefresh, headers, ...rest } = options;

  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && !skipRefresh) {
    if (await refreshSession()) {
      return apiFetch<T>(path, { ...options, skipRefresh: true });
    }
    accessToken = null;
    onUnauthenticated?.();
  }

  if (!response.ok) {
    throw new ApiError(await parseProblem(response), response.status);
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json()) as { data: T };
  return payload.data;
}

/** Returns the envelope rather than just `data`, for paginated lists. */
export async function apiFetchPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{
  data: T[];
  meta: { page: { totalItems: number; totalPages: number; page: number } };
}> {
  const { body, skipRefresh, headers, ...rest } = options;

  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && !skipRefresh) {
    if (await refreshSession()) {
      return apiFetchPage<T>(path, { ...options, skipRefresh: true });
    }
    accessToken = null;
    onUnauthenticated?.();
  }

  if (!response.ok) throw new ApiError(await parseProblem(response), response.status);
  return response.json();
}

export { refreshSession, BASE as API_BASE };
