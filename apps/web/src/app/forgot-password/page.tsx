'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { AuthCard } from '@/components/auth-card';

/**
 * Ask for a password reset link (v2.24).
 *
 * The endpoint has existed since the auth phase; nothing on the web ever
 * reached it, and the email it sends pointed at /reset-password, which did not
 * exist either - so the whole recovery path was unreachable from a browser.
 *
 * The success message is deliberately the same whether or not the address has
 * an account, matching the server, which always answers 202 for the same
 * reason: a page that says "no such user" is a way to enumerate who works here.
 */

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
});
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  async function onSubmit(values: Values) {
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: { email: values.email } });
    } catch {
      // Swallowed on purpose. A failure here is either the address not existing
      // or the mail provider being unhappy, and telling the two apart is
      // exactly what the endpoint refuses to do.
    }
    setSent(true);
  }

  return (
    <AuthCard
      title={sent ? 'Check your email' : 'Forgot your password?'}
      intro={
        sent
          ? 'If that address has a PioAssets account, a reset link is on its way.'
          : 'Enter your work email and we will send you a link to set a new password.'
      }
      footer={
        <Link href="/login" className="font-medium text-[var(--color-brand)] hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="mt-6 grid gap-3 text-sm text-[var(--color-content-muted)]">
          <p className="flex items-start gap-2">
            <MailCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-[var(--color-brand)]"
            />
            The link is valid for 30 minutes and can be used once.
          </p>
          <p>
            Nothing arrived? Check your spam folder, then ask an administrator — some mail systems
            quarantine automated messages.
          </p>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 grid gap-4" noValidate>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="username"
                      placeholder="you@company.com"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" loading={form.formState.isSubmitting}>
              Send reset link
            </Button>
          </form>
        </Form>
      )}
    </AuthCard>
  );
}
