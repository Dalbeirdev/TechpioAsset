'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { PasswordInput } from '@/components/ui/password-input';

/**
 * Operator SMTP settings (v2.12). Mail setup used to require a server login
 * and an env edit; this page writes the same settings to the database, where
 * the mail router picks them up on the next send - no restart. The password
 * is stored encrypted and never comes back to the browser.
 */

interface MailSettings {
  configured: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string | null;
  fromAddress?: string;
  hasPassword?: boolean;
  updatedAt?: string;
}

export default function PlatformMailPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['platform-mail'],
    queryFn: () => apiFetch<MailSettings>('/platform/mail-settings'),
  });

  const [form, setForm] = useState<{
    host: string;
    port: string;
    secure: boolean;
    username: string;
    password: string;
    fromAddress: string;
  } | null>(null);

  // Seed the form once from the server state; afterwards it is the editor's.
  const current = settings.data;
  const draft = form ?? {
    host: current?.host ?? 'smtp-relay.brevo.com',
    port: String(current?.port ?? 587),
    secure: current?.secure ?? false,
    username: current?.username ?? '',
    password: '',
    fromAddress: current?.fromAddress ?? 'TechpioAsset <no-reply@techpio.com>',
  };
  const set = (patch: Partial<typeof draft>) => setForm({ ...draft, ...patch });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<MailSettings>('/platform/mail-settings', {
        method: 'PUT',
        body: {
          host: draft.host.trim(),
          port: Number(draft.port) || 587,
          secure: draft.secure,
          username: draft.username.trim() || null,
          // Absent password = keep the stored one; only send what was typed.
          ...(draft.password !== '' || !current?.hasPassword
            ? { password: draft.password }
            : {}),
          fromAddress: draft.fromAddress.trim(),
        },
      }),
    onSuccess: () => {
      toast.success('SMTP settings saved — effective on the next email');
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['platform-mail'] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save'),
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch<{ delivered: boolean; to: string; error?: string }>('/platform/mail-settings/test', {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) =>
      r.delivered
        ? toast.success(`Test email sent to ${r.to} — check the inbox`)
        : toast.error(r.error ? `Send failed: ${r.error}` : 'Mail is still simulated — save SMTP settings first'),
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Test failed'),
  });

  const clear = useMutation({
    mutationFn: () => apiFetch('/platform/mail-settings', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('SMTP settings removed — mail falls back to the server default');
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['platform-mail'] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not remove'),
  });

  if (settings.isPending) return <Skeleton className="mx-auto h-80 max-w-2xl" />;
  if (settings.isError) {
    const forbidden = settings.error instanceof ApiError && settings.error.status === 403;
    return (
      <ErrorState
        title={forbidden ? 'Operators only' : 'Could not load mail settings'}
        detail={
          forbidden
            ? 'This console is limited to platform administrators.'
            : (settings.error as Error).message
        }
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Mail aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Email (SMTP)
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Platform-wide delivery for invitations and notification emails. Saved settings apply
            to the next email — no restart.
          </p>
        </div>
        <Link href="/platform/tenants" className="text-sm text-[var(--color-brand)]">
          Tenants →
        </Link>
      </header>

      <Card className="grid gap-3 p-5">
        <p className="text-sm">
          Status:{' '}
          <span
            className="font-semibold"
            style={current?.configured ? undefined : { color: 'var(--tone-warning-fg)' }}
          >
            {current?.configured
              ? `Configured (${current.host})`
              : 'Not configured — email is simulated'}
          </span>
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SMTP host" htmlFor="mh">
            <Input id="mh" value={draft.host} onChange={(e) => set({ host: e.target.value })} placeholder="smtp-relay.brevo.com" />
          </Field>
          <Field label="Port" htmlFor="mp">
            <Input id="mp" inputMode="numeric" value={draft.port} onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })} placeholder="587" />
          </Field>
          <Field label="Username / login" htmlFor="mu">
            <Input id="mu" value={draft.username} onChange={(e) => set({ username: e.target.value })} placeholder="9a1b2c001@smtp-brevo.com" />
          </Field>
          <Field label={current?.hasPassword ? 'SMTP key (leave blank to keep current)' : 'SMTP key / password'} htmlFor="mk">
            <PasswordInput id="mk" autoComplete="off" value={draft.password} onChange={(e) => set({ password: e.target.value })} placeholder={current?.hasPassword ? '••••••••  (stored)' : 'Paste the SMTP key'} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="From address" htmlFor="mf">
              <Input id="mf" value={draft.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} placeholder="TechpioAsset <no-reply@techpio.com>" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.secure} onChange={(e) => set({ secure: e.target.checked })} className="size-4 rounded border-[var(--color-border-strong)]" />
            Implicit TLS (port 465). Leave off for STARTTLS on 587.
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={save.isPending}
            disabled={!draft.host.trim() || !draft.fromAddress.trim()}
            onClick={() => save.mutate()}
          >
            Save settings
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={test.isPending}
            disabled={!current?.configured}
            onClick={() => test.mutate()}
          >
            <Send aria-hidden="true" className="mr-1 size-3.5" /> Send me a test email
          </Button>
          {current?.configured ? (
            <Button
              size="sm"
              variant="danger"
              loading={clear.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Remove SMTP settings?',
                  body: 'Email goes back to the server default — on this deployment that means simulated delivery, and invitations stop reaching inboxes.',
                  confirmLabel: 'Remove',
                  destructive: true,
                });
                if (ok) clear.mutate();
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-[var(--color-content-subtle)]">
          For Brevo: sign up at brevo.com → SMTP &amp; API → SMTP → generate a key, and verify
          your from-address under Senders &amp; Domains so mail lands in inboxes, not spam. The
          key is stored encrypted and never shown again.
        </p>
      </Card>
    </div>
  );
}
