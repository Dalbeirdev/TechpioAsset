'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Radar } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Tone } from '@/components/assets/discovery-tabs';
import { AgentsTab } from '@/components/discovery/agents-tab';

/**
 * v2.5 H5 — the discovery review queue. Exact serials auto-matched already;
 * everything here is what needs (or records) a human decision. Confirm links
 * and applies the payload; ignore parks the device and stays parked.
 */

interface DeviceRow {
  id: string;
  externalId: string | null;
  serialNumber: string | null;
  hostname: string | null;
  source: string;
  matchState: 'MATCHED' | 'PROPOSED' | 'CONFLICT' | 'UNMATCHED' | 'IGNORED';
  lastSeenAt: string;
  asset: { id: string; assetTag: string; name: string; serialNumber: string | null } | null;
}

const STATES = ['ALL', 'PROPOSED', 'CONFLICT', 'UNMATCHED', 'MATCHED', 'IGNORED'] as const;
type StateFilter = (typeof STATES)[number];

const STATE_TONE: Record<DeviceRow['matchState'], string> = {
  MATCHED: 'success',
  PROPOSED: 'info',
  CONFLICT: 'critical',
  UNMATCHED: 'neutral',
  IGNORED: 'muted',
};

interface RunSummary {
  provider: string;
  simulated: boolean;
  received: number;
  matched: number;
  proposed: number;
  conflict: number;
  unmatched: number;
}

export default function DiscoveryPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canReconcile = can(PERMISSIONS.DISCOVERY_RECONCILE);
  const canIngest = can(PERMISSIONS.DISCOVERY_INGEST);
  const [state, setState] = useState<StateFilter>('ALL');
  const [tab, setTab] = useState<'devices' | 'agents'>('devices');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['discovery', state],
    queryFn: () =>
      apiFetchPage<DeviceRow>(
        `/discovery/devices?pageSize=50${state === 'ALL' ? '' : `&state=${state}`}`,
      ),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['discovery'] });

  const runNow = useMutation({
    mutationFn: () => apiFetch<RunSummary>('/discovery/run', { method: 'POST', body: {} }),
    onSuccess: (summary) => {
      toast.success(
        `${summary.provider} discovery${summary.simulated ? ' (simulated)' : ''}: ${summary.received} device(s) — ${summary.matched} matched, ${summary.proposed} proposed, ${summary.conflict} conflict, ${summary.unmatched} unmatched.`,
      );
      void refresh();
    },
    onError: (caught) =>
      toast.error(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Discovery run failed.',
      ),
  });

  const review = useMutation({
    mutationFn: (input: { id: string; verb: 'confirm' | 'ignore' }) =>
      apiFetch(`/discovery/devices/${input.id}/${input.verb}`, { method: 'POST', body: {} }),
    onSuccess: (_, input) => {
      toast.success(input.verb === 'confirm' ? 'Match confirmed and data applied.' : 'Device ignored.');
      void refresh();
    },
    onError: (caught) =>
      toast.error(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not update the device.',
      ),
  });

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Discovery</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Devices seen by agents and connectors. Exact serial matches link automatically —
            everything else waits for a decision here.
          </p>
        </div>
        {canIngest ? (
          <Button loading={runNow.isPending} onClick={() => runNow.mutate()}>
            <Radar aria-hidden="true" className="size-4" /> Run discovery
          </Button>
        ) : null}
      </header>

      {/* Two jobs live on this page: triaging what has been discovered, and
          managing the agents doing the discovering. */}
      <div
        role="tablist"
        aria-label="Discovery sections"
        className="flex gap-1 border-b border-[var(--color-border)]"
      >
        {(
          [
            ['devices', 'Devices'],
            ['agents', 'Agents'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'border-b-2 border-[var(--color-brand)] px-3.5 py-2 text-sm font-semibold text-[var(--color-brand)]'
                : 'border-b-2 border-transparent px-3.5 py-2 text-sm font-medium text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }
          >
            <span className="flex items-center gap-1.5">
              {key === 'agents' ? <Laptop aria-hidden="true" className="size-3.5" /> : null}
              {label}
            </span>
          </button>
        ))}
      </div>

      {tab === 'agents' ? <AgentsTab /> : null}

      {tab === 'devices' ? (
      <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by state">
        {STATES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={state === key}
            onClick={() => setState(key)}
            className={
              state === key
                ? 'rounded-full bg-[var(--color-brand)] px-3 py-1 text-xs font-semibold text-white'
                : 'rounded-full border border-[var(--color-border-strong)] px-3 py-1 text-xs font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]'
            }
          >
            {key === 'ALL' ? 'All' : key.charAt(0) + key.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load discovery" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No devices"
            description={
              state === 'ALL'
                ? 'Run discovery, or point an agent at /discovery/ingest.'
                : `Nothing in the ${state.toLowerCase()} state.`
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Discovered devices, {data.meta.page.totalItems} in total
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">Device</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">State</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Asset</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Last seen</th>
                  {canReconcile ? (
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((row) => {
                  const reviewable = row.matchState === 'PROPOSED' || row.matchState === 'CONFLICT';
                  const parkable = reviewable || row.matchState === 'UNMATCHED';
                  return (
                    <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{row.hostname ?? row.serialNumber ?? row.externalId}</p>
                        <p className="text-xs text-[var(--color-content-subtle)]">
                          {row.serialNumber ? `SN ${row.serialNumber} · ` : ''}
                          {row.source.toLowerCase()}
                        </p>
                      </td>
                      <td className="px-4 py-2.5">
                        <Tone tone={STATE_TONE[row.matchState]}>
                          {row.matchState.toLowerCase()}
                        </Tone>
                      </td>
                      <td className="px-4 py-2.5">
                        {row.asset ? (
                          <Link href={`/assets/${row.asset.id}`} className="hover:underline">
                            {row.asset.assetTag}
                            <span className="block text-xs text-[var(--color-content-subtle)]">
                              {row.asset.name}
                            </span>
                          </Link>
                        ) : (
                          <span className="text-[var(--color-content-subtle)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                        {new Date(row.lastSeenAt).toLocaleString()}
                      </td>
                      {canReconcile ? (
                        <td className="px-4 py-2.5">
                          <span className="flex justify-end gap-1.5">
                            {reviewable ? (
                              <Button
                                size="sm"
                                loading={review.isPending}
                                onClick={() => review.mutate({ id: row.id, verb: 'confirm' })}
                              >
                                Confirm
                              </Button>
                            ) : null}
                            {parkable ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={review.isPending}
                                onClick={() => review.mutate({ id: row.id, verb: 'ignore' })}
                              >
                                Ignore
                              </Button>
                            ) : null}
                          </span>
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
      </>
      ) : null}
    </div>
  );
}
