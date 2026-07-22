'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card, Field, Input } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';

export default function LoginPage() {
  const router = useRouter();
  const { login, status } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password, needsMfa ? mfaCode : undefined);
      if (result === 'mfa-required') {
        setNeedsMfa(true);
        return;
      }
      router.replace('/dashboard');
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Unable to sign in. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">TechpioAsset</h1>
            <p className="mt-1 text-sm text-[var(--color-content-muted)]">
              Manage Assets. Control Costs. Simplify Operations.
            </p>
          </div>
          <ThemeToggle />
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={needsMfa}
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={needsMfa}
              />
            </Field>

            {needsMfa ? (
              <Field
                label="Authentication code"
                htmlFor="mfaCode"
                hint="Six-digit code from your authenticator app."
              >
                <Input
                  id="mfaCode"
                  name="mfaCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                />
              </Field>
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

            <Button type="submit" loading={submitting}>
              {needsMfa ? 'Verify' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--color-content-subtle)]">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          Sessions expire automatically and every action is audited.
        </p>
      </div>
    </main>
  );
}
