'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, User } from 'lucide-react';
import { apiFetchPage } from '@/lib/api-client';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { SchedulesPanel } from '@/components/maintenance/schedules-panel';

/**
 * v2.5 H5 — the work-order board. Open work grouped by status with SLA
 * indicators: an overdue deadline reads red, an escalated order says so.
 * Closed work keeps the table treatment below the board.
 */

interface MaintenanceRow {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledFor: string | null;
  completedAt: string | null;
  technicianId: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  asset: { id: string; assetTag: string; name: string } | null;
  vendor: { id: string; name: string } | null;
}

const COLUMNS = [
  { key: 'REQUESTED', label: 'Requested', tone: 'neutral' },
  { key: 'SCHEDULED', label: 'Scheduled', tone: 'info' },
  { key: 'IN_PROGRESS', label: 'In progress', tone: 'warning' },
  { key: 'ON_HOLD', label: 'On hold', tone: 'neutral' },
] as const;

const CLOSED = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

const CLOSED_TONE: Record<string, string> = {
  COMPLETED: 'success',
  CANCELLED: 'muted',
  FAILED: 'critical',
};

function slaBadge(row: MaintenanceRow) {
  if (!row.slaDueAt) return null;
  const overdue = new Date(row.slaDueAt).getTime() < Date.now();
  const label = overdue
    ? `SLA overdue · ${new Date(row.slaDueAt).toLocaleDateString()}`
    : `SLA ${new Date(row.slaDueAt).toLocaleDateString()}`;
  const tone = overdue ? 'critical' : 'info';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{
        color: `var(--tone-${tone}-fg)`,
        backgroundColor: `var(--tone-${tone}-bg)`,
        borderColor: `var(--tone-${tone}-border)`,
      }}
    >
      {overdue ? <AlertTriangle aria-hidden="true" className="size-3" /> : null}
      {label}
    </span>
  );
}

export default function MaintenancePage() {
  const [view, setView] = useState<'board' | 'schedules'>('board');
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => apiFetchPage<MaintenanceRow>('/maintenance?pageSize=100'),
  });

  if (view === 'schedules') {
    return (
      <div className="grid gap-4">
        <MaintenanceHeader view={view} setView={setView} />
        <SchedulesPanel />
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <ErrorState title="Could not load maintenance" detail={(error as Error).message} />;
  }

  const open = data.data.filter((row) => !CLOSED.has(row.status));
  const closed = data.data.filter((row) => CLOSED.has(row.status)).slice(0, 15);

  return (
    <div className="grid gap-4">
      <MaintenanceHeader view={view} setView={setView} />

      {open.length === 0 ? (
        <EmptyState title="No open work orders" description="Repairs and inspections appear here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((column) => {
            const rows = open.filter((row) => row.status === column.key);
            return (
              <section key={column.key} aria-label={`${column.label}, ${rows.length} work orders`}>
                <h2 className="flex items-center justify-between px-1 pb-2 text-sm font-semibold">
                  {column.label}
                  <span
                    className="rounded-full px-2 py-0.5 text-xs tabular-nums"
                    style={{
                      color: `var(--tone-${column.tone}-fg)`,
                      backgroundColor: `var(--tone-${column.tone}-bg)`,
                    }}
                  >
                    {rows.length}
                  </span>
                </h2>
                <div className="grid gap-2">
                  {rows.length === 0 ? (
                    <p className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-border)] p-3 text-center text-xs text-[var(--color-content-subtle)]">
                      Nothing here
                    </p>
                  ) : (
                    rows.map((row) => (
                      <Link key={row.id} href={`/maintenance/${row.id}`} className="block">
                        <Card className="grid gap-1.5 p-3 transition-colors hover:border-[var(--color-border-strong)]">
                          <p className="text-sm font-medium leading-snug">{row.title}</p>
                          <p className="text-xs text-[var(--color-content-subtle)]">
                            {row.asset?.assetTag ?? '—'} · {row.type.toLowerCase()}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {slaBadge(row)}
                            {row.escalatedAt ? (
                              <span
                                className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium"
                                style={{
                                  color: 'var(--tone-critical-fg)',
                                  backgroundColor: 'var(--tone-critical-bg)',
                                  borderColor: 'var(--tone-critical-border)',
                                }}
                              >
                                escalated
                              </span>
                            ) : null}
                            {row.technicianId ? (
                              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-content-subtle)]">
                                <User aria-hidden="true" className="size-3" /> assigned
                              </span>
                            ) : null}
                          </div>
                        </Card>
                      </Link>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {closed.length > 0 ? (
        <Card>
          <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">
            Recently closed
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recently closed work orders</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">Work</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Asset</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Outcome</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {closed.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/maintenance/${row.id}`} className="font-medium hover:underline">
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.asset?.assetTag ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex rounded-full border px-2 py-0.5 text-xs"
                        style={{
                          color: `var(--tone-${CLOSED_TONE[row.status] ?? 'neutral'}-fg)`,
                          backgroundColor: `var(--tone-${CLOSED_TONE[row.status] ?? 'neutral'}-bg)`,
                          borderColor: `var(--tone-${CLOSED_TONE[row.status] ?? 'neutral'}-border)`,
                        }}
                      >
                        {row.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.completedAt ? new Date(row.completedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Board / schedules switch shared by both views. */
function MaintenanceHeader({
  view,
  setView,
}: {
  view: 'board' | 'schedules';
  setView: (v: 'board' | 'schedules') => void;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Maintenance</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {view === 'board'
            ? 'Work orders across the estate — overdue SLAs read red and escalate once, automatically.'
            : 'Recurring service. The daily sweep raises each schedule’s work order when it falls due.'}
        </p>
      </div>
      <div role="tablist" aria-label="Maintenance view" className="flex gap-1">
        {(
          [
            ['board', 'Work orders'],
            ['schedules', 'Schedules'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={
              view === key
                ? 'rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 text-sm font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]'
            }
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );
}
