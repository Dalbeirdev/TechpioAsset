'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Lock, Mail, Save as SaveIcon, Send, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { PasswordInput } from '@/components/ui/password-input';

/**
 * Operator SMTP settings (v2.12, redesigned v2.15 to match the operator's
 * other consoles). Provider presets fill in the server details so the
 * operator only supplies what is theirs; the password is stored encrypted
 * and never comes back to the browser. Settings apply on the next send.
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

type Security = 'ssl' | 'starttls' | 'none';

/** Server details per provider, so the operator only types credentials. */
const PROVIDERS: { key: string; label: string; host?: string; port?: number; security?: Security; hint?: string }[] = [
  { key: 'hostinger', label: 'Hostinger Email', host: 'smtp.hostinger.com', port: 465, security: 'ssl',
    hint: 'Username is the full mailbox address (create it in hPanel → Emails); the from-address must be the same mailbox.' },
  { key: 'titan', label: 'Titan Email (via Hostinger or direct)', host: 'smtp.titan.email', port: 465, security: 'ssl',
    hint: 'Username is the full mailbox address; the from-address must match it.' },
  { key: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, security: 'starttls',
    hint: 'Use an App Password (Google Account → Security → 2-Step Verification → App passwords), not the account password.' },
  { key: 'm365', label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, security: 'starttls',
    hint: 'SMTP AUTH must be enabled for the mailbox in the Microsoft 365 admin center.' },
  { key: 'postmark', label: 'Postmark', host: 'smtp.postmarkapp.com', port: 587, security: 'starttls',
    hint: 'Username and password are both the Server API token.' },
  { key: 'sendgrid', label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, security: 'starttls',
    hint: 'Username is literally "apikey"; the password is your API key.' },
  { key: 'brevo', label: 'Brevo (formerly Sendinblue)', host: 'smtp-relay.brevo.com', port: 587, security: 'starttls',
    hint: 'SMTP & API → SMTP → generate a key. Verify the from-address under Senders & Domains.' },
  { key: 'mailgun', label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, security: 'starttls',
    hint: 'Username is the full SMTP login shown under Sending → Domain settings.' },
  { key: 'ses', label: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, security: 'starttls',
    hint: 'Use SMTP credentials from the SES console (not IAM keys); adjust the host to your region.' },
  { key: 'custom', label: 'Other / custom SMTP' },
];

/** "Name <addr>" ⇄ separate fields, so the sender edits like two inputs. */
function splitFrom(v: string | undefined): { name: string; address: string } {
  const m = /^(.*)<(.+)>\s*$/.exec(v ?? '');
  if (m?.[1] !== undefined && m?.[2] !== undefined)
    return { name: m[1].trim(), address: m[2].trim() };
  return { name: '', address: (v ?? '').trim() };
}

const selectCls =
  'h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export default function PlatformMailPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['platform-mail'],
    queryFn: () => apiFetch<MailSettings>('/platform/mail-settings'),
  });

  const [form, setForm] = useState<{
    provider: string;
    host: string;
    port: string;
    security: Security;
    username: string;
    password: string;
    fromAddress: string;
    fromName: string;
  } | null>(null);
  const [testTo, setTestTo] = useState<string | null>(null);

  // Seed once from the server state; afterwards the form is the editor's.
  const current = settings.data;
  const from = splitFrom(current?.fromAddress);
  const draft = form ?? {
    provider: PROVIDERS.find((p) => p.host && p.host === current?.host)?.key ?? 'custom',
    host: current?.host ?? '',
    port: String(current?.port ?? 587),
    security: (current?.secure ? 'ssl' : 'starttls') as Security,
    username: current?.username ?? '',
    password: '',
    fromAddress: from.address,
    fromName: from.name || 'TechpioAsset',
  };
  const set = (patch: Partial<typeof draft>) => setForm({ ...draft, ...patch });
  const provider = PROVIDERS.find((p) => p.key === draft.provider);

  const pickProvider = (key: string) => {
    const p = PROVIDERS.find((x) => x.key === key);
    set({
      provider: key,
      ...(p?.host ? { host: p.host, port: String(p.port), security: p.security } : {}),
    });
  };

  const composedFrom = draft.fromName.trim()
    ? `${draft.fromName.trim()} <${draft.fromAddress.trim()}>`
    : draft.fromAddress.trim();

  const save = useMutation({
    mutationFn: () =>
      apiFetch<MailSettings>('/platform/mail-settings', {
        method: 'PUT',
        body: {
          host: draft.host.trim(),
          port: Number(draft.port) || 587,
          secure: draft.security === 'ssl',
          username: draft.username.trim() || null,
          // Absent password = keep the stored one; only send what was typed.
          ...(draft.password !== '' || !current?.hasPassword
            ? { password: draft.password }
            : {}),
          fromAddress: composedFrom,
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
    mutationFn: (to: string) =>
      apiFetch<{ delivered: boolean; to: string; error?: string }>('/platform/mail-settings/test', {
        method: 'POST',
        body: { to },
      }),
    onSuccess: (r) =>
      r.delivered
        ? toast.success(`Test email sent to ${r.to} — check the inbox (and spam)`)
        : toast.error(
            r.error
              ? `Send failed: ${r.error}`
              : 'Mail is still simulated — save SMTP settings first',
          ),
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Test failed'),
  });

  // Distinct from save: the save body OMITS an empty password to mean "keep
  // the stored one", so clearing needs the explicit empty string the API
  // treats as "remove the credential".
  const removeStored = useMutation({
    mutationFn: () =>
      apiFetch<MailSettings>('/platform/mail-settings', {
        method: 'PUT',
        body: {
          host: draft.host.trim(),
          port: Number(draft.port) || 587,
          secure: draft.security === 'ssl',
          username: draft.username.trim() || null,
          password: '',
          fromAddress: composedFrom,
        },
      }),
    onSuccess: () => {
      toast.success('Stored password removed');
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['platform-mail'] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not remove',
      ),
  });

  const clear = useMutation({
    mutationFn: () => apiFetch('/platform/mail-settings', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('SMTP settings removed — mail falls back to the server default');
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['platform-mail'] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not remove',
      ),
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
      <header className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand)] text-white shadow-sm">
          <Mail aria-hidden="true" className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email (SMTP)</h1>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            Platform-wide delivery for invitations and notification emails.
            <br />
            Saved settings apply to the next email — no restart.
          </p>
          <Link
            href="/platform/tenants"
            className="mt-1 inline-block text-sm font-medium text-[var(--color-brand)]"
          >
            Tenants →
          </Link>
        </div>
      </header>

      <Card className="grid gap-4 p-5">
        <p className="flex items-center gap-2 text-sm">
          <span>
            Status:{' '}
            <span
              className="font-semibold"
              style={current?.configured ? undefined : { color: 'var(--tone-warning-fg)' }}
            >
              {current?.configured
                ? `Configured (${current.host})`
                : 'Not configured — email is simulated'}
            </span>
          </span>
          {current?.configured ? (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' }}
            >
              Active
            </span>
          ) : null}
        </p>

        <div className="grid gap-3 sm:grid-cols-[2fr_2fr_6rem]">
          <Field label="Provider" htmlFor="mprov">
            <select
              id="mprov"
              value={draft.provider}
              onChange={(e) => pickProvider(e.target.value)}
              className={selectCls}
            >
              {PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              Picking one fills in the server details, so you only supply what is yours.
            </p>
          </Field>
          <Field label="Host" htmlFor="mh">
            <Input
              id="mh"
              value={draft.host}
              onChange={(e) => set({ host: e.target.value, provider: 'custom' })}
              placeholder="smtp.example.com"
            />
          </Field>
          <Field label="Port" htmlFor="mp">
            <Input
              id="mp"
              inputMode="numeric"
              value={draft.port}
              onChange={(e) => set({ port: e.target.value.replace(/\D/g, '') })}
              placeholder="587"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-[2fr_3fr]">
          <Field label="Security" htmlFor="msec">
            <select
              id="msec"
              value={draft.security}
              onChange={(e) => {
                const security = e.target.value as Security;
                // Convenience only: flip the port when it is still the other
                // mode's default, never when the operator typed something else.
                const port =
                  security === 'ssl' && draft.port === '587'
                    ? '465'
                    : security !== 'ssl' && draft.port === '465'
                      ? '587'
                      : draft.port;
                set({ security, port });
              }}
              className={selectCls}
            >
              <option value="ssl">SSL/TLS (465)</option>
              <option value="starttls">STARTTLS (587)</option>
              <option value="none">None (not recommended)</option>
            </select>
          </Field>
          <Field label="Username" htmlFor="mu">
            <Input
              id="mu"
              value={draft.username}
              onChange={(e) => set({ username: e.target.value })}
              placeholder="info@yourdomain.com"
            />
          </Field>
        </div>

        <div>
          <Field
            label={current?.hasPassword ? 'Password' : 'Password / SMTP key'}
            htmlFor="mk"
          >
            <PasswordInput
              id="mk"
              autoComplete="off"
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder={current?.hasPassword ? 'Stored — leave blank to keep it' : 'Paste the password or SMTP key'}
            />
          </Field>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--color-content-subtle)]">
              Encrypted before it is stored, and never sent back to this page.
            </p>
            {current?.hasPassword ? (
              <button
                type="button"
                className="text-xs font-medium"
                style={{ color: 'var(--tone-critical-fg)' }}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Remove the stored password?',
                    body: 'The server settings stay; only the credential is cleared. Sends will fail until a new one is saved (unless the server needs no authentication).',
                    confirmLabel: 'Remove stored',
                    destructive: true,
                  });
                  if (ok) removeStored.mutate();
                }}
              >
                Remove stored
              </button>
            ) : null}
          </div>
        </div>

        {provider?.hint ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2.5 text-xs text-[var(--color-content-muted)]">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[var(--color-brand)]" />
            <span>{provider.hint}</span>
          </p>
        ) : null}

        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            Sender
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
            Who your emails come from. Most providers reject mail from a domain you have not
            verified with them.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="From address" htmlFor="mf">
              <Input
                id="mf"
                value={draft.fromAddress}
                onChange={(e) => set({ fromAddress: e.target.value })}
                placeholder="no-reply@techpio.com"
              />
            </Field>
            <Field label="From name" htmlFor="mfn">
              <Input
                id="mfn"
                value={draft.fromName}
                onChange={(e) => set({ fromName: e.target.value })}
                placeholder="TechpioAsset"
              />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={save.isPending}
              disabled={!draft.host.trim() || !draft.fromAddress.trim()}
              onClick={() => save.mutate()}
            >
              <SaveIcon aria-hidden="true" className="mr-1 size-3.5" /> Save settings
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
                <Trash2 aria-hidden="true" className="mr-1 size-3.5" /> Remove all
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="grid gap-3 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            Send a test
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">
            The only way to know these work. Uses the saved settings.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Field label="Send to" htmlFor="mt">
              <Input
                id="mt"
                type="email"
                value={testTo ?? user?.email ?? ''}
                onChange={(e) => setTestTo(e.target.value)}
              />
            </Field>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={test.isPending}
            disabled={!current?.configured || !(testTo ?? user?.email)}
            onClick={() => test.mutate((testTo ?? user?.email)!)}
          >
            <Send aria-hidden="true" className="mr-1 size-3.5" /> Send test email
          </Button>
        </div>
      </Card>

      <p className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2.5 text-xs text-[var(--color-content-subtle)]">
        <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-[var(--color-brand)]" />
        <span>
          Saved here, these take precedence over the server&apos;s environment configuration — no
          SSH, no redeploy. The password is stored encrypted and never shown again.
        </span>
      </p>
    </div>
  );
}
