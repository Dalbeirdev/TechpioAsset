'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/providers/auth-provider';

/**
 * Entry point. Sends signed-in users to the dashboard and everyone else to the
 * sign-in screen; the Phase 0 token-gallery page has served its purpose and is
 * gone.
 */
export default function IndexPage() {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  return (
    <div className="grid min-h-screen place-items-center">
      <p className="text-sm text-[var(--color-content-subtle)]">Loading…</p>
    </div>
  );
}
