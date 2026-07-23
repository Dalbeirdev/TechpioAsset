import type { TokenStore } from './api-client';

/**
 * Web fallback for {@link SecureTokenStore}.
 *
 * A browser has no keychain/keystore, so on web the refresh token is kept in
 * localStorage. Metro resolves this `.web.ts` variant automatically for the web
 * bundle; the native build keeps using expo-secure-store (the keychain) as the
 * tamper-resistant home for the credential. This exists so the app can be run on
 * a laptop for review — a browser is deliberately not treated as a secure store.
 */
const REFRESH_KEY = 'techpioasset.refresh';

export class SecureTokenStore implements TokenStore {
  async getRefreshToken(): Promise<string | null> {
    try {
      return globalThis.localStorage?.getItem(REFRESH_KEY) ?? null;
    } catch {
      return null;
    }
  }

  async setRefreshToken(token: string | null): Promise<void> {
    try {
      if (token === null) globalThis.localStorage?.removeItem(REFRESH_KEY);
      else globalThis.localStorage?.setItem(REFRESH_KEY, token);
    } catch {
      /* storage unavailable (private mode, SSR) — token simply is not persisted */
    }
  }
}
