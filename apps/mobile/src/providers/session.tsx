import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from '@techpioasset/contracts';
import { ApiClient } from '../lib/api-client';
import { SecureTokenStore } from '../lib/secure-token-store';

/**
 * Session and auth for the mobile app (spec section 16 employee/admin features).
 *
 * Login mirrors the web flow — email/password, then a TOTP challenge when MFA is
 * enrolled — but adds biometric re-entry: after the first successful login the
 * refresh token is kept in the keystore and Face ID / fingerprint unlocks the app
 * without retyping the password.
 */

interface SessionState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous' | 'locked';
  api: ApiClient;
  login: (email: string, password: string, mfaCode?: string) => Promise<'ok' | 'mfa-required'>;
  unlockWithBiometrics: () => Promise<boolean>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);
const tokenStore = new SecureTokenStore();
const apiUrl = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:3001';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<SessionState['status']>('loading');

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiUrl,
        tokenStore,
        onUnauthenticated: () => {
          setUser(null);
          setStatus('anonymous');
        },
      }),
    [],
  );

  // On launch, a stored refresh token means the device was signed in before, so
  // require a biometric unlock rather than a full re-login.
  useEffect(() => {
    void (async () => {
      const stored = await tokenStore.getRefreshToken();
      setStatus(stored ? 'locked' : 'anonymous');
    })();
  }, []);

  const finishLogin = useCallback(
    (accessToken: string, refresh: string | null, authUser: AuthUser) => {
      api.setAccessToken(accessToken);
      if (refresh) void tokenStore.setRefreshToken(refresh);
      setUser(authUser);
      setStatus('authenticated');
    },
    [api],
  );

  const login = useCallback<SessionState['login']>(
    async (email, password, mfaCode) => {
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(mfaCode ? { mfaCode } : {}) }),
      });
      if (!response.ok) throw new Error('Email or password is incorrect');

      const payload = (await response.json()) as {
        data: { accessToken: string; user: AuthUser } | { mfaRequired: true };
      };
      if ('mfaRequired' in payload.data) return 'mfa-required';

      finishLogin(
        payload.data.accessToken,
        response.headers.get('X-Refresh-Token'),
        payload.data.user,
      );
      return 'ok';
    },
    [finishLogin],
  );

  const unlockWithBiometrics = useCallback<SessionState['unlockWithBiometrics']>(async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();

    // If the device has no biometrics, fall through to a silent refresh so the
    // user is not locked out; the keystore still protects the token at rest.
    if (hasHardware && enrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock TechpioAsset',
        fallbackLabel: 'Use password',
      });
      if (!result.success) return false;
    }

    try {
      const me = await api.request<AuthUser>('/auth/me');
      setUser(me);
      setStatus('authenticated');
      return true;
    } catch {
      await tokenStore.setRefreshToken(null);
      setStatus('anonymous');
      return false;
    }
  }, [api]);

  const logout = useCallback(async () => {
    try {
      await api.request('/auth/logout', { method: 'POST' });
    } finally {
      await tokenStore.setRefreshToken(null);
      api.setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
    }
  }, [api]);

  const value = useMemo(
    () => ({ user, status, api, login, unlockWithBiometrics, logout }),
    [user, status, api, login, unlockWithBiometrics, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
