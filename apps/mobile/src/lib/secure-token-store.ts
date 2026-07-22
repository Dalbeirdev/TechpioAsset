import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './api-client';

/**
 * TokenStore backed by expo-secure-store.
 *
 * The refresh token lives in the platform keychain (iOS) / keystore (Android),
 * not in AsyncStorage — a native app has no httpOnly cookie, so the keystore is
 * the equivalent tamper-resistant home for a long-lived credential. The access
 * token is never persisted; it lives only in memory in the ApiClient.
 */
const REFRESH_KEY = 'techpioasset.refresh';

export class SecureTokenStore implements TokenStore {
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_KEY);
  }

  async setRefreshToken(token: string | null): Promise<void> {
    if (token === null) {
      await SecureStore.deleteItemAsync(REFRESH_KEY);
    } else {
      await SecureStore.setItemAsync(REFRESH_KEY, token, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  }
}
