'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { PERMISSIONS } from '@techpioasset/domain';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';

interface MaintenanceDetail {
  id: string;
  type: string;
  status: string;
  title: string;
  description: string | null;
  scheduledFor: string | null;
  completedAt: string | null;
  resolutionNotes: string | null;
  replacementRecommended: boolean;
  serviceCost?: string | null;
  downtimeHours?: string | null;
  asset: { id: string; assetTag: string; name: string; status: string } | null;
  vendor: { id: string; name: string } | null;
}

export default function MaintenanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.MAINTENANCE_MANAGE);

  const [cost, setCost] = useState('');
  const [downtime, setDowntime] = useState('');
  const [notes, setNotes] = useState('');

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['maintenance', id],
    queryFn: () => apiFetch<MaintenanceDetail>(`/maintenance/${id}`),
  });

  const act = useMutation({
    mutationFn: (input: { action: string; body?: unknown }) =>
      apiFetch(`/maintenance/${id}/${input.action}`, { method: 'POST', body: input.body ?? {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['maintenance', id] });
      await queryClient.invalidateQueries({ queryKey: ['maintenance'] });
    },
  });

  if (isPending) return <Skeleton className="h-80" />;
  if (isError)
    return <ErrorState title="Could not load this record" detail={(error as Error).message} />;

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{data.title}</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {data.type} · {data.status.replace(/_/g, ' ').toLowerCase()}
          {data.asset ? (
            <>
              {' · '}
              <Link href={`/assets/${data.asset.id}`} className="hover:underline">
                {data.asset.assetTag}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      {data.description ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="mt-2 text-sm text-[var(--color-content-muted)]">{data.description}</p>
        </Card>
      ) : null}

      {data.completedAt ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Outcome</h2>
          <dl className="mt-3 grid gap-1.5 text-sm">
            {data.serviceCost ? (
              <div className="flex justify-between">
                <dt className="text-[var(--color-content-muted)]">Service cost</dt>
                <dd className="tabular-nums">{Number(data.serviceCost).toLocaleString()}</dd>
              </div>
            ) : null}
            {data.downtimeHours ? (
              <div className="flex justify-between">
                <dt className="text-[var(--color-content-muted)]">Downtime</dt>
                <dd className="tabular-nums">{data.downtimeHours} h</dd>
              </div>
            ) : null}
            {data.replacementRecommended ? (
              <p className="mt-1 text-[var(--tone-warning-fg)]">Replacement recommended.</p>
            ) : null}
          </dl>
          {data.resolutionNotes ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">{data.resolutionNotes}</p>
          ) : null}
        </Card>
      ) : canManage ? (
        <Card className="grid gap-4 p-5">
          <h2 className="text-sm font-semibold">Actions</h2>

          {data.status === 'REQUESTED' || data.status === 'SCHEDULED' ? (
            <Button
              size="sm"
              loading={act.isPending}
              onClick={() => act.mutate({ action: 'start' })}
            >
              Start work
            </Button>
          ) : null}

          {data.status === 'IN_PROGRESS' ? (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Service cost" htmlFor="cost">
                  <Input
                    id="cost"
                    inputMode="decimal"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Downtime (hours)" htmlFor="downtime">
                  <Input
                    id="downtime"
                    inputMode="decimal"
                    value={downtime}
                    onChange={(e) => setDowntime(e.target.value)}
                    placeholder="0"
                  />
                </Field>
              </div>
              <Field label="Resolution notes" htmlFor="notes">
                <textarea
                  id="notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2.5 text-sm"
                />
              </Field>
              {act.isError ? (
                <p role="alert" className="text-xs" style={{ color: 'var(--tone-critical-fg)' }}>
                  {act.error instanceof ApiError
                    ? act.error.problem?.detail
                    : 'Could not complete.'}
                </p>
              ) : null}
              <Button
                loading={act.isPending}
                onClick={() =>
                  act.mutate({
                    action: 'complete',
                    body: {
                      ...(cost ? { serviceCost: cost } : {}),
                      ...(downtime ? { downtimeHours: downtime } : {}),
                      ...(notes ? { resolutionNotes: notes } : {}),
                      restoreAsset: true,
                    },
                  })
                }
              >
                Complete and return to service
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
