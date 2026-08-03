'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { Tone } from '@/components/assets/discovery-tabs';

/**
 * v2.7 R5 — preventive maintenance schedules. The v2.5 API shipped without a
 * surface, so recurring service could only be configured by API call. The
 * sweep spawns the work orders; this is where the recurrence is owned.
 */

interface ScheduleRow {
  id: string;
  title: string;
  intervalDays: number;
  nextDueAt: string;
  lastCreatedAt: string | null;
  isActive: boolean;
  asset: { id: string; assetTag: string; name: string } | null;
}

interface AssetOption {
  id: string;
  assetTag: string;
  name: string;
}

const INTERVALS = [
  { label: 'Monthly', value: 30 },
  { label: 'Quarterly', value: 90 },
  { label: 'Every 6 months', value: 182 },
  { label: 'Yearly', value: 365 },
] as const;

export function SchedulesPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.MAINTENANCE_MANAGE);

  const [assetId, setAssetId] = useState('');
  const [title, setTitle] = useState('');
  const [intervalDays, setIntervalDays] = useState<number>(90);

  const schedules = useQuery({
    queryKey: ['maintenance-schedules'],
    queryFn: () => apiFetch<ScheduleRow[]>('/maintenance/schedules'),
  });
  const assets = useQuery({
    queryKey: ['schedule-asset-options'],
    queryFn: async () => {
      const page = await apiFetch<{ data: AssetOption[] }>('/assets?pageSize=100');
      // The list endpoint returns an envelope; unwrap defensively.
      return (Array.isArray(page) ? page : page.data) as AssetOption[];
    },
    enabled: canManage,
    staleTime: 60_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['maintenance-schedules'] });
  const onError = (caught: unknown) =>
    toast.error(
      caught instanceof ApiError ? (caught.problem.detail ?? caught.problem.title) : 'That failed.',
    );

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/maintenance/schedules', {
        method: 'POST',
        body: { assetId, title: title.trim(), intervalDays },
      }),
    onSuccess: () => {
      toast.success('Schedule created — the sweep will raise its work orders.');
      setTitle('');
      setAssetId('');
      void refresh();
    },
    onError,
  });

  const toggle = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      apiFetch(`/maintenance/schedules/${input.id}`, {
        method: 'PATCH',
        body: { isActive: input.isActive },
      }),
    onSuccess: () => void refresh(),
    onError,
  });

  return (
    <div className="grid gap-4">
      {canManage ? (
        <Card className="grid gap-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock aria-hidden="true" className="size-4" />
            New preventive schedule
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Asset" htmlFor="sch-asset">
              <select
                id="sch-asset"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
              >
                <option value="">Choose…</option>
                {assets.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.assetTag} — {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Work to repeat" htmlFor="sch-title">
              <Input
                id="sch-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Clean filters and test airflow"
              />
            </Field>
            <Field label="Every" htmlFor="sch-interval">
              <select
                id="sch-interval"
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button
            className="justify-self-start"
            size="sm"
            loading={create.isPending}
            disabled={!assetId || !title.trim()}
            onClick={() => create.mutate()}
          >
            Create schedule
          </Button>
        </Card>
      ) : null}

      <Card>
        <h2 className="border-b border-[var(--color-border)] px-4 py-3 text-sm font-semibold">
          Preventive schedules
        </h2>
        {schedules.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : schedules.isError || !schedules.data || schedules.data.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[var(--color-content-muted)]">
            No preventive schedules yet. Recurring service raises its own work orders once set.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Preventive maintenance schedules</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">Work</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Asset</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Every</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Next due</th>
                  {canManage ? (
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {schedules.data.map((row) => (
                  <tr key={row.id} className={row.isActive ? '' : 'opacity-60'}>
                    <td className="px-4 py-2.5 font-medium">{row.title}</td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.asset?.assetTag ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.intervalDays} days
                    </td>
                    <td className="px-4 py-2.5">
                      {row.isActive ? (
                        new Date(row.nextDueAt).toLocaleDateString()
                      ) : (
                        <Tone tone="muted">paused</Tone>
                      )}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={toggle.isPending}
                          onClick={() => toggle.mutate({ id: row.id, isActive: !row.isActive })}
                        >
                          {row.isActive ? 'Pause' : 'Resume'}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
