'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card } from '@/components/ui';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { ThemeToggle } from '@/components/theme-toggle';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().optional(),
});
type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, status } = useAuth();
  const [needsMfa, setNeedsMfa] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', mfaCode: '' },
  });

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard');
  }, [status, router]);

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const result = await login(
        values.email,
        values.password,
        needsMfa ? values.mfaCode : undefined,
      );
      if (result === 'mfa-required') {
        setNeedsMfa(true);
        return;
      }
      router.replace('/dashboard');
    } catch (caught) {
      setFormError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Unable to sign in. Please try again.',
      );
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
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="username"
                        autoFocus
                        disabled={needsMfa}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        disabled={needsMfa}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {needsMfa ? (
                <FormField
                  control={form.control}
                  name="mfaCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Authentication code</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          autoFocus
                          {...field}
                          onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
                        />
                      </FormControl>
                      <FormDescription>Six-digit code from your authenticator app.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

              {formError ? (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                  style={{
                    color: 'var(--tone-critical-fg)',
                    backgroundColor: 'var(--tone-critical-bg)',
                    borderColor: 'var(--tone-critical-border)',
                  }}
                >
                  {formError}
                </p>
              ) : null}

              <Button type="submit" loading={form.formState.isSubmitting}>
                {needsMfa ? 'Verify' : 'Sign in'}
              </Button>
            </form>
          </Form>
        </Card>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-[var(--color-content-subtle)]">
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          Sessions expire automatically and every action is audited.
        </p>
      </div>
    </main>
  );
}
