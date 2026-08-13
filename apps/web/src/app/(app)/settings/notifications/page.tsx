'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Eye, Mail, RotateCcw, Send, X } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Input, Skeleton } from '@/components/ui';

/**
 * Notification engine console (v2.18): WHEN → SEND TO → CC → TEMPLATE →
 * STATUS, plus the branded-email template editor with live preview/test and
 * the outgoing email log. SETTINGS_MANAGE only (the API enforces it).
 */

interface Rule {
  type: string;
  label: string;
  mandatory: boolean;
  channels: string[];
  enabled: boolean;
  notifyPrimary: boolean;
  recipientRoleKeys: string[];
  ccRoleKeys: string[];
  escalationRoleKeys: string[];
  thresholds: number[];
  stored: boolean;
}
interface RoleOption { key: string; name: string }
interface Template {
  type: string;
  label: string;
  customized: boolean;
  enabled: boolean;
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
}
interface LogRow {
  id: string;
  type: string;
  toEmail: string;
  subject: string;
  status: string;
  error: string | null;
  createdAt: string;
}

const TABS = [
  ['rules', 'Routing rules'],
  ['templates', 'Email templates'],
  ['log', 'Email log'],
] as const;

export default function NotificationSettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('rules');

  const overview = useQuery({
    queryKey: ['notify-overview'],
    queryFn: () => apiFetch<{ sentToday: number; failedToday: number; warrantyToday: number }>('/notifications/admin/overview'),
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <header className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand)] text-white shadow-sm">
          <BellRing aria-hidden="true" className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            Who gets told about what, how the emails read, and whether they arrived.
          </p>
        </div>
        {overview.data ? (
          <dl className="hidden gap-4 text-right sm:flex">
            {[
              ['Sent today', overview.data.sentToday, ''],
              ['Failed', overview.data.failedToday, overview.data.failedToday > 0 ? 'text-[var(--tone-critical-fg)]' : ''],
              ['Warranty alerts', overview.data.warrantyToday, ''],
            ].map(([k, v, cls]) => (
              <div key={k as string}>
                <dt className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-content-subtle)]">{k}</dt>
                <dd className={`text-lg font-bold tabular-nums ${cls}`}>{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </header>

      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? 'border border-b-0 border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-content)]'
                : 'text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'rules' ? <RulesTab /> : tab === 'templates' ? <TemplatesTab /> : <LogTab />}
    </div>
  );
}

/* ── rules ───────────────────────────────────────────────────────────────── */

function RulesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Rule | null>(null);

  const data = useQuery({
    queryKey: ['notify-rules'],
    queryFn: () => apiFetch<{ rules: Rule[]; roles: RoleOption[] }>('/notifications/admin/rules'),
  });

  const save = useMutation({
    mutationFn: (rule: Rule) =>
      apiFetch(`/notifications/admin/rules/${rule.type}`, {
        method: 'PATCH',
        body: {
          enabled: rule.enabled,
          notifyPrimary: rule.notifyPrimary,
          recipientRoleKeys: rule.recipientRoleKeys,
          ccRoleKeys: rule.ccRoleKeys,
          escalationRoleKeys: rule.escalationRoleKeys,
          thresholds: rule.thresholds,
        },
      }),
    onSuccess: async () => {
      toast.success('Rule saved');
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['notify-rules'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save'),
  });

  if (data.isPending) return <Skeleton className="h-72" />;
  if (data.isError) return <ErrorState title="Could not load rules" detail={(data.error as Error).message} />;

  const roleName = (key: string) => data.data.roles.find((r) => r.key === key)?.name ?? key;

  return (
    <>
      <Card className="divide-y divide-[var(--color-border)] p-0">
        {data.data.rules.map((rule) => (
          <button
            key={rule.type}
            type="button"
            onClick={() => setEditing({ ...rule })}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-sunken)]"
          >
            <span className={`size-2 flex-none rounded-full ${rule.enabled ? 'bg-[var(--tone-success-fg)]' : 'bg-[var(--color-content-subtle)]/40'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{rule.label}</span>
              <span className="block truncate text-xs text-[var(--color-content-muted)]">
                {rule.notifyPrimary ? 'Person concerned' : null}
                {rule.notifyPrimary && rule.recipientRoleKeys.length ? ' + ' : ''}
                {rule.recipientRoleKeys.map(roleName).join(', ')}
                {rule.ccRoleKeys.length ? ` · CC: ${rule.ccRoleKeys.map(roleName).join(', ')}` : ''}
                {!rule.enabled ? ' · disabled' : ''}
              </span>
            </span>
            {rule.mandatory ? (
              <span className="flex-none rounded-full bg-[var(--color-tint-blue)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-tint-blue-fg)]">Mandatory</span>
            ) : null}
            {rule.stored ? (
              <span className="flex-none rounded-full bg-[var(--color-tint-purple)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-tint-purple-fg)]">Custom</span>
            ) : null}
          </button>
        ))}
      </Card>

      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Edit rule ${editing.label}`}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">{editing.label}</h2>
              <button type="button" aria-label="Close" onClick={() => setEditing(null)} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-surface-sunken)]">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  disabled={editing.mandatory}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Enabled {editing.mandatory ? <span className="text-xs text-[var(--color-content-subtle)]">(mandatory — cannot be disabled)</span> : null}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editing.notifyPrimary}
                  onChange={(e) => setEditing({ ...editing, notifyPrimary: e.target.checked })}
                />
                Notify the person directly concerned (holder, employee, requester)
              </label>

              {(
                [
                  ['recipientRoleKeys', 'Send to roles'],
                  ['ccRoleKeys', 'CC roles'],
                  ['escalationRoleKeys', 'Escalation roles (added when thresholds are critical)'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <p className="font-medium">{label}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {data.data.roles.map((role) => {
                      const active = editing[field].includes(role.key);
                      return (
                        <button
                          key={role.key}
                          type="button"
                          onClick={() =>
                            setEditing({
                              ...editing,
                              [field]: active
                                ? editing[field].filter((k) => k !== role.key)
                                : [...editing[field], role.key],
                            })
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            active
                              ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                              : 'border-[var(--color-border-strong)] text-[var(--color-content-muted)] hover:border-[var(--color-brand)]'
                          }`}
                        >
                          {role.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {editing.type === 'WARRANTY_EXPIRATION' ? (
                <div>
                  <p className="font-medium">Warranty thresholds (days before expiry)</p>
                  <Input
                    className="mt-1.5"
                    value={editing.thresholds.join(', ')}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        thresholds: e.target.value
                          .split(/[,\s]+/)
                          .map((v) => Number(v))
                          .filter((n) => Number.isInteger(n) && n >= 0),
                      })
                    }
                    placeholder="90, 60, 30, 15, 7, 1, 0"
                  />
                  <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                    One alert per mark; 0 = the expiry day itself. At 7 days or less the escalation roles join automatically.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button loading={save.isPending} onClick={() => save.mutate(editing)}>Save rule</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ── templates ───────────────────────────────────────────────────────────── */

function TemplatesTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Template | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ['notify-templates'],
    queryFn: () =>
      apiFetch<{ templates: Template[]; variables: { group: string; vars: string[] }[] }>('/notifications/admin/templates'),
  });

  const save = useMutation({
    mutationFn: (tpl: Template) =>
      apiFetch(`/notifications/admin/templates/${tpl.type}`, {
        method: 'PATCH',
        body: { subject: tpl.subject, heading: tpl.heading, body: tpl.body, ctaLabel: tpl.ctaLabel, enabled: tpl.enabled },
      }),
    onSuccess: async () => {
      toast.success('Template saved');
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['notify-templates'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save'),
  });

  const reset = useMutation({
    mutationFn: (type: string) => apiFetch(`/notifications/admin/templates/${type}/reset`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      toast.success('Reset to the built-in default');
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['notify-templates'] });
    },
  });

  const preview = useMutation({
    mutationFn: (type: string) => apiFetch<{ html: string }>(`/notifications/admin/templates/${type}/preview`),
    onSuccess: (r) => setPreviewHtml(r.html),
    onError: () => toast.error('Preview failed'),
  });

  const sendTest = useMutation({
    mutationFn: (type: string) => apiFetch(`/notifications/admin/templates/${type}/test`, { method: 'POST', body: {} }),
    onSuccess: () => toast.success('Test email sent to your own address'),
    onError: () => toast.error('Test send failed'),
  });

  if (data.isPending) return <Skeleton className="h-72" />;
  if (data.isError) return <ErrorState title="Could not load templates" detail={(data.error as Error).message} />;

  return (
    <>
      <Card className="divide-y divide-[var(--color-border)] p-0">
        {data.data.templates.map((tpl) => (
          <div key={tpl.type} className="flex items-center gap-3 px-4 py-3">
            <Mail aria-hidden="true" className="size-4 flex-none text-[var(--color-brand)]" />
            <button type="button" onClick={() => setEditing({ ...tpl })} className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">{tpl.label}</span>
              <span className="block truncate text-xs text-[var(--color-content-muted)]">{tpl.subject}</span>
            </button>
            {tpl.customized ? (
              <span className="flex-none rounded-full bg-[var(--color-tint-purple)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-tint-purple-fg)]">Customized</span>
            ) : null}
            <button
              type="button"
              onClick={() => preview.mutate(tpl.type)}
              className="grid size-8 flex-none place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]"
              aria-label={`Preview ${tpl.label}`}
            >
              <Eye className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => sendTest.mutate(tpl.type)}
              className="grid size-8 flex-none place-items-center rounded-lg text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]"
              aria-label={`Send test ${tpl.label}`}
            >
              <Send className="size-4" />
            </button>
          </div>
        ))}
      </Card>

      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Edit template ${editing.label}`}>
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">{editing.label} — email template</h2>
              <button type="button" aria-label="Close" onClick={() => setEditing(null)} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-surface-sunken)]">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-3 text-sm">
              <label className="grid gap-1">
                <span className="font-medium">Subject</span>
                <Input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">Heading</span>
                <Input value={editing.heading} onChange={(e) => setEditing({ ...editing, heading: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">Body</span>
                <textarea
                  rows={6}
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
                />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">Button text</span>
                <Input value={editing.ctaLabel} onChange={(e) => setEditing({ ...editing, ctaLabel: e.target.value })} />
              </label>

              <details className="rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">Available variables</summary>
                <div className="mt-2 grid gap-1.5">
                  {data.data.variables.map((g) => (
                    <p key={g.group} className="text-[var(--color-content-muted)]">
                      <span className="font-semibold">{g.group}:</span> {g.vars.join('  ')}
                    </p>
                  ))}
                </div>
              </details>
            </div>

            <div className="mt-5 flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => preview.mutate(editing.type)}>
                  <Eye aria-hidden="true" className="mr-1 size-3.5" /> Preview
                </Button>
                {editing.customized ? (
                  <Button variant="secondary" size="sm" loading={reset.isPending} onClick={() => reset.mutate(editing.type)}>
                    <RotateCcw aria-hidden="true" className="mr-1 size-3.5" /> Reset to default
                  </Button>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                <Button loading={save.isPending} onClick={() => save.mutate(editing)}>Save template</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {previewHtml ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Email preview">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
              <p className="text-sm font-semibold">Email preview (sample data)</p>
              <button type="button" aria-label="Close preview" onClick={() => setPreviewHtml(null)} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-surface-sunken)]">
                <X className="size-4" />
              </button>
            </div>
            <iframe title="Email preview" srcDoc={previewHtml} className="h-[70vh] w-full bg-white" />
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ── email log ───────────────────────────────────────────────────────────── */

function LogTab() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());

  const data = useQuery({
    queryKey: ['email-logs', status, q, page],
    queryFn: () => apiFetch<{ rows: LogRow[]; total: number; pageSize: number }>(`/notifications/admin/email-logs?${params}`),
  });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search recipient or subject…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-xs" />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="h-10 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="SENT">Sent</option>
          <option value="SIMULATED">Simulated</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {data.isPending ? (
        <Skeleton className="mt-4 h-48" />
      ) : data.isError ? (
        <ErrorState title="Could not load the email log" detail={(data.error as Error).message} />
      ) : data.data.rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--color-content-subtle)]">No emails match — the log fills as notifications go out.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {data.data.rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span
                className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  row.status === 'FAILED'
                    ? 'bg-[var(--color-tint-rose)] text-[var(--color-tint-rose-fg)]'
                    : row.status === 'SIMULATED'
                      ? 'bg-[var(--color-tint-amber)] text-[var(--color-tint-amber-fg)]'
                      : 'bg-[var(--color-tint-green)] text-[var(--color-tint-green-fg)]'
                }`}
              >
                {row.status}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.subject}</span>
                <span className="block truncate text-xs text-[var(--color-content-muted)]">
                  {row.toEmail} · {row.type.replaceAll('_', ' ').toLowerCase()}
                  {row.error ? ` · ${row.error}` : ''}
                </span>
              </span>
              <span className="flex-none text-xs text-[var(--color-content-subtle)]">
                {new Date(row.createdAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.data && data.data.total > data.data.pageSize ? (
        <div className="mt-3 flex items-center justify-between text-sm">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-xs text-[var(--color-content-subtle)]">Page {page} of {Math.ceil(data.data.total / data.data.pageSize)}</span>
          <Button variant="secondary" size="sm" disabled={page >= Math.ceil(data.data.total / data.data.pageSize)} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      ) : null}
    </Card>
  );
}
