'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthUser } from '@techpioasset/contracts';
import {
  apiFetch,
  refreshSession,
  setAccessToken,
  setUnauthenticatedHandler,
} from '@/lib/api-client';

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string, mfaCode?: string) => Promise<'ok' | 'mfa-required'>;
  logout: () => Promise<void>;
  /** True when the user holds every listed permission. */
  can: (...permissions: string[]) => boolean;
  /** Re-reads /auth/me so a just-saved profile edit shows without a reload. */
  refresh: () => Promise<void>;
  /** Non-null while signed in AS someone else (v2.12): who the admin really is. */
  impersonating: { adminName: string } | null;
  /** Switch this browser session to the target user for up to 15 minutes. */
  impersonate: (userId: string) => Promise<void>;
  /** Return to the administrator's own session (the refresh cookie is still theirs). */
  stopImpersonating: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [impersonating, setImpersonating] = useState<{ adminName: string } | null>(null);

  // On mount the access token is gone (it only ever lived in memory), so the
  // session is rebuilt from the httpOnly refresh cookie. This is what makes a
  // page reload keep you signed in without storing a token where scripts can
  // reach it. It is also why impersonation cannot survive a reload: the cookie
  // belongs to the administrator, so a reload quietly restores their session.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const restored = await refreshSession();
      if (cancelled) return;
      if (!restored) {
        setStatus('anonymous');
        return;
      }
      try {
        const me = await apiFetch<AuthUser>('/auth/me');
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(null);
      setStatus('anonymous');
    });
    return () => setUnauthenticatedHandler(null);
  }, []);

  const login = useCallback<AuthState['login']>(async (email, password, mfaCode) => {
    const result = await apiFetch<{ accessToken: string; user: AuthUser } | { mfaRequired: true }>(
      '/auth/login',
      {
        method: 'POST',
        body: { email, password, ...(mfaCode ? { mfaCode } : {}) },
      },
    );

    if ('mfaRequired' in result) return 'mfa-required';

    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus('authenticated');
    return 'ok';
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      // Cleared even if the call fails: the user asked to sign out, so the
      // client-side session must not survive a network error.
      setAccessToken(null);
      setUser(null);
      setStatus('anonymous');
      setImpersonating(null);
      router.push('/login');
    }
  }, [router]);

  const can = useCallback<AuthState['can']>(
    (...permissions) => {
      if (!user) return false;
      const held = new Set(user.permissions);
      return permissions.every((permission) => held.has(permission));
    },
    [user],
  );

  const refresh = useCallback(async () => {
    try {
      setUser(await apiFetch<AuthUser>('/auth/me'));
    } catch {
      // A failed refresh keeps the session as it was; the edit is already
      // saved server-side and will appear on the next full load.
    }
  }, []);

  const impersonate = useCallback<AuthState['impersonate']>(
    async (userId) => {
      const adminName = user?.displayName ?? user?.email ?? 'Administrator';
      const result = await apiFetch<{ accessToken: string; expiresIn: number; user: AuthUser }>(
        `/users/${userId}/impersonate`,
        { method: 'POST', body: {} },
      );
      setAccessToken(result.accessToken);
      setUser(result.user);
      setImpersonating({ adminName });
      router.push('/dashboard');
    },
    [user, router],
  );

  const stopImpersonating = useCallback(async () => {
    // Drop the impersonated token; the next request 401s and the api client
    // rebuilds the session from the refresh cookie - the administrator's own.
    setAccessToken(null);
    await refreshSession();
    try {
      setUser(await apiFetch<AuthUser>('/auth/me'));
    } finally {
      setImpersonating(null);
      router.push('/people');
    }
  }, [router]);

  const value = useMemo(
    () => ({
      user,
      status,
      login,
      logout,
      can,
      refresh,
      impersonating,
      impersonate,
      stopImpersonating,
    }),
    [user, status, login, logout, can, refresh, impersonating, impersonate, stopImpersonating],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
