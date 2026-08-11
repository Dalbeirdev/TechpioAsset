'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Laptop, RefreshCw, ShieldOff, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiBaseUrl, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';

/**
 * Discovery → Agents (v2.13).
 *
 * Two things IT needs in one place: the enrolment token that installers carry,
 * and the list of laptops actually reporting. The token is shown exactly once —
 * it is stored only as a hash, so there is no "show it again", and the panel
 * says so rather than letting someone hunt for a button that cannot exist.
 */

interface AgentRow {
  id: string;
  machineId: string;
  hostname: string | null;
  serialNumber: string | null;
  platform: string | null;
  agentVersion: string | null;
  enrolledAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** "3 hours ago" — a device list is read for recency, not timestamps. */
function sinceLabel(value: string | null): string {
  if (!value) return 'never';
  const ms = Date.now() - new Date(value).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** A laptop that has not called home in a week is worth noticing. */
function isStale(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  return Date.now() - new Date(lastSeenAt).getTime() > 7 * 86_400_000;
}

export function AgentsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const canManage = can(PERMISSIONS.DISCOVERY_INGEST);
  const canRevoke = can(PERMISSIONS.DISCOVERY_RECONCILE);
  const [newToken, setNewToken] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ['discovery-agents'],
    queryFn: () => apiFetch<AgentRow[]>('/discovery/agents'),
  });

  const mint = useMutation({
    mutationFn: () =>
      apiFetch<{ token: string }>('/discovery/agents/enrolment-token', {
        method: 'POST',
        body: {},
      }),
    onSuccess: (res) => {
      setNewToken(res.token);
      toast.success('Enrolment token generated — copy it now');
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not generate a token',
      ),
  });

  const disable = useMutation({
    mutationFn: () => apiFetch('/discovery/agents/enrolment-token', { method: 'DELETE' }),
    onSuccess: () => {
      setNewToken(null);
      toast.success('Enrolment disabled — no new laptop can enrol');
    },
    onError: () => toast.error('Could not disable enrolment'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/discovery/agents/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Agent revoked — its credential stops working immediately');
      await qc.invalidateQueries({ queryKey: ['discovery-agents'] });
    },
    onError: () => toast.error('Could not revoke that agent'),
  });

  const rows = agents.data ?? [];
  const active = rows.filter((r) => !r.revokedAt);
  // The API base, not the page origin: in development the portal is served
  // from a different port than the API, so a command built from the page URL
  // quietly points at the wrong host — worse than offering no command at all.
  const installCommand =
    `.\\TechpioAgent.ps1 -PortalUrl ${apiBaseUrl} ` +
    `-EnrolmentToken ${newToken ?? '<your-token>'} -Install`;

  return (
    <div className="grid gap-4">
      {canManage ? (
        <Card className="grid gap-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Enrolment token</h2>
              <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                Installers carry this to enrol a laptop. It can only be exchanged for a
                device credential — it cannot read or write anything on its own. Generating a new
                one immediately stops every installer carrying the old one.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" loading={mint.isPending} onClick={() => mint.mutate()}>
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {newToken ? 'Generate again' : 'Generate token'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={disable.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Disable agent enrolment?',
                    body: 'No new laptop will be able to enrol until you generate a token again. Laptops already enrolled keep reporting.',
                    confirmLabel: 'Disable',
                    destructive: true,
                  });
                  if (ok) disable.mutate();
                }}
              >
                <ShieldOff aria-hidden="true" className="size-3.5" /> Turn off
              </Button>
            </div>
          </div>

          {newToken ? (
            <div
              className="rounded-[var(--radius-control)] border px-3 py-2.5 text-sm"
              style={{
                color: 'var(--tone-warning-fg)',
                backgroundColor: 'var(--tone-warning-bg)',
                borderColor: 'var(--tone-warning-border)',
              }}
            >
              <p className="font-semibold">Enrolment token — shown once, copy it now:</p>
              <code className="mt-1 block select-all break-all text-xs">{newToken}</code>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={async () => {
                  await navigator.clipboard.writeText(newToken);
                  toast.success('Token copied');
                }}
              >
                <Copy aria-hidden="true" className="size-3.5" /> Copy token
              </Button>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-medium text-[var(--color-content-subtle)]">
              Run this on each laptop, elevated:
            </p>
            <div className="mt-1 flex items-start gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs">
                {installCommand}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(installCommand);
                  toast.success('Command copied');
                }}
              >
                <Copy aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              The agent installs its own scheduled task, so it only needs running once per machine.
            </p>
          </div>
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-sm font-semibold">
            Enrolled laptops
            {rows.length > 0 ? (
              <span className="ml-2 text-xs font-normal text-[var(--color-content-subtle)]">
                {active.length} active
                {rows.length - active.length > 0 ? ` · ${rows.length - active.length} revoked` : ''}
              </span>
            ) : null}
          </h2>
        </div>

        {agents.isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No laptops enrolled yet"
            description="Generate an enrolment token above and run the agent on a machine. It appears here within a minute of its first report."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
                  <th className="px-5 py-2.5 font-medium">Laptop</th>
                  <th className="px-4 py-2.5 font-medium">Serial</th>
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Last reported</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  {canRevoke ? <th className="px-4 py-2.5" /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const revoked = Boolean(row.revokedAt);
                  const stale = !revoked && isStale(row.lastSeenAt);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-sunken)]"
                    >
                      <td className="px-5 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          <Laptop
                            aria-hidden="true"
                            className="size-3.5 text-[var(--color-content-subtle)]"
                          />
                          {row.hostname ?? 'Unnamed device'}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--color-content-subtle)]">
                          {row.machineId.slice(0, 18)}…
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{row.serialNumber ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-content-muted)]">
                        {row.platform ?? '—'}
                        {row.agentVersion ? ` · v${row.agentVersion}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-content-muted)]">
                        {sinceLabel(row.lastSeenAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={
                            revoked
                              ? {
                                  background: 'var(--tone-critical-bg)',
                                  color: 'var(--tone-critical-fg)',
                                }
                              : stale
                                ? {
                                    background: 'var(--tone-warning-bg)',
                                    color: 'var(--tone-warning-fg)',
                                  }
                                : {
                                    background: 'var(--tone-success-bg)',
                                    color: 'var(--tone-success-fg)',
                                  }
                          }
                        >
                          {revoked ? 'Revoked' : stale ? 'Not reporting' : 'Active'}
                        </span>
                      </td>
                      {canRevoke ? (
                        <td className="px-4 py-2.5 text-right">
                          {!revoked ? (
                            <button
                              type="button"
                              aria-label={`Revoke ${row.hostname ?? row.machineId}`}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `Revoke ${row.hostname ?? 'this laptop'}?`,
                                  body: 'Its agent stops being able to report immediately. The enrolment history is kept, and the laptop can be enrolled again later.',
                                  confirmLabel: 'Revoke',
                                  destructive: true,
                                });
                                if (ok) revoke.mutate(row.id);
                              }}
                              className="rounded p-1 text-[var(--color-content-subtle)] hover:text-[var(--tone-critical-fg)]"
                            >
                              <Trash2 aria-hidden="true" className="size-3.5" />
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
