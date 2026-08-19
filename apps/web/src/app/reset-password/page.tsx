'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui';
import { PasswordInput } from '@/components/ui/password-input';
import { AuthCard, AuthError } from '@/components/auth-card';

/**
 * Where a password-reset email lands (v2.24).
 *
 * The email has pointed here since the auth phase shipped; the page did not
 * exist, so every reset link 404'd. Same single step as accepting an invite:
 * choose a password. Completing it also ends every other session the account
 * has open, which is the server's doing and worth saying out loud - somebody
 * resetting a password may be doing it because someone else has their old one.
 */

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useMutation({
    mutationFn: () => apiFetch('/auth/reset-password', { method: 'POST', body: { token, password } }),
    onSuccess: () => {
      setDone(true);
      setTimeout(() => router.replace('/login'), 2500);
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'That link is no longer valid. Ask for a new one.',
      );
    },
  });

  const match = password.length > 0 && password === passwordAgain;

  if (done) {
    return (
      <AuthCard
        title="Password changed"
        intro="Taking you to sign in…"
        footer={
          <Link href="/login" className="font-medium text-[var(--color-brand)] hover:underline">
            Go there now
          </Link>
        }
      >
        <p className="mt-6 flex items-start gap-2 text-sm text-[var(--color-content-muted)]">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-[var(--tone-success-fg)]"
          />
          Every other session on this account has been signed out. If somebody else knew the old
          password, they no longer have a way in.
        </p>
      </AuthCard>
    );
  }

  if (!token) {
    return (
      <AuthCard
        title="This link is incomplete"
        intro="Open the link from your reset email, or ask for a new one."
        footer={
          <Link
            href="/forgot-password"
            className="font-medium text-[var(--color-brand)] hover:underline"
          >
            Send a new link
          </Link>
        }
      >
        <></>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      intro="You are the only person who will ever know it."
      footer={
        <Link href="/login" className="font-medium text-[var(--color-brand)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form
        className="mt-6 grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (match) reset.mutate();
        }}
      >
        <PasswordInput
          aria-label="New password"
          autoFocus
          autoComplete="new-password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-[var(--color-content-subtle)]">
          At least 12 characters, with an uppercase letter, a lowercase letter and a digit.
        </p>
        <PasswordInput
          aria-label="Repeat new password"
          autoComplete="new-password"
          placeholder="Repeat password"
          value={passwordAgain}
          onChange={(e) => setPasswordAgain(e.target.value)}
        />
        {passwordAgain.length > 0 && !match ? (
          <p className="text-xs" style={{ color: 'var(--tone-critical-fg)' }}>
            The two passwords do not match.
          </p>
        ) : null}
        {error ? <AuthError>{error}</AuthError> : null}
        <Button type="submit" loading={reset.isPending} disabled={!match}>
          Set my new password
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
