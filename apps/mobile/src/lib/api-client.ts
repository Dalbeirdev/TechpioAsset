import type { ProblemDetails } from '@techpioasset/contracts';

/**
 * Mobile API client.
 *
 * Mirrors the web client's contract — in-memory access token, refresh on 401,
 * problem+json errors — but tokens persist through expo-secure-store rather than
 * an httpOnly cookie, because a native app has no cookie jar. SecureStore keeps
 * the refresh token in the platform keychain/keystore, not in plain
 * AsyncStorage.
 *
 * The token store is injected so this module stays free of the React Native
 * runtime and can be exercised in tests.
 */

export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails | null,
    readonly status: number,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.problem?.code;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  /** Called when the session cannot be refreshed, so the app can route to login. */
  onUnauthenticated?: () => void;
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  private get base(): string {
    return `${this.options.baseUrl}/api/v1`;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /**
   * Refreshes the session using the stored refresh token, de-duplicating
   * concurrent attempts so a screen firing several requests at once does not
   * present the rotated token more than once (which the server would treat as
   * replay and revoke the whole family).
   */
  private async refresh(): Promise<boolean> {
    this.refreshInFlight ??= (async () => {
      try {
        const stored = await this.options.tokenStore.getRefreshToken();
        if (!stored) return false;
        const response = await fetch(`${this.base}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Refresh-Token': stored },
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as {
          data: { accessToken: string };
        };
        this.accessToken = payload.data.accessToken;
        const rotated = response.headers.get('X-Refresh-Token');
        if (rotated) await this.options.tokenStore.setRefreshToken(rotated);
        return true;
      } catch {
        return false;
      } finally {
        queueMicrotask(() => {
          this.refreshInFlight = null;
        });
      }
    })();
    return this.refreshInFlight;
  }

  async request<T>(
    path: string,
    options: { method?: string; body?: unknown; skipRefresh?: boolean } = {},
  ): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response.status === 401 && !options.skipRefresh) {
      if (await this.refresh()) {
        return this.request<T>(path, { ...options, skipRefresh: true });
      }
      this.accessToken = null;
      this.options.onUnauthenticated?.();
    }

    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as ProblemDetails | null;
      throw new ApiError(problem, response.status);
    }

    if (response.status === 204) return undefined as T;
    const payload = (await response.json()) as { data: T };
    return payload.data;
  }
}
