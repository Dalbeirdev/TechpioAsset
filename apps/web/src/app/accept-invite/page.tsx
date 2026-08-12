'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Boxes, ShieldCheck } from 'lucide-react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { Button, Card } from '@/components/ui';
import { PasswordInput } from '@/components/ui/password-input';

/**
 * Where an invitation link lands (v2.12). Public by necessity - the person
 * has no account yet. One step: choose a password; accepting also verifies
 * the email (only that inbox received the link) and activates the account.
 */

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const accept = useMutation({
    mutationFn: () => apiFetch('/auth/accept-invite', { method: 'POST', body: { token, password } }),
    onSuccess: () => {
      setDone(true);
      setTimeout(() => router.replace('/login'), 2500);
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Something went wrong. Ask for a fresh invitation.',
      );
    },
  });

  const match = password.length > 0 && password === passwordAgain;

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-surface-sunken)] p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-[var(--color-brand)] text-[var(--color-brand-contrast)]">
            <Boxes aria-hidden="true" className="size-4" />
          </span>
          TechpioAsset
        </div>

        {done ? (
          <div className="grid gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck aria-hidden="true" className="size-4 text-[var(--tone-success-fg)]" />
              Your account is ready
            </p>
            <p className="text-sm text-[var(--color-content-muted)]">
              Taking you to sign in… or{' '}
              <Link href="/login" className="text-[var(--color-brand)]">
                go there now
              </Link>
              .
            </p>
          </div>
        ) : !token ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            This invitation link is incomplete. Open the link from your invitation email, or ask
            your administrator to send a new one.
          </p>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (match) accept.mutate();
            }}
          >
            <div>
              <h1 className="text-base font-semibold">Welcome — set your password</h1>
              <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
                At least 12 characters. You are the only person who will ever know it.
              </p>
            </div>
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
            {error ? (
              <p
                role="alert"
                className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                style={{
                  color: 'var(--tone-critical-fg)',
                  backgroundColor: 'var(--tone-critical-bg)',
                  borderColor: 'var(--tone-critical-border)',
                }}
              >
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={accept.isPending} disabled={!match}>
              Activate my account
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

export default function AcceptInvitePage() {
  // useSearchParams requires a Suspense boundary during prerender.
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
