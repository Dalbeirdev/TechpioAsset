'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { PERMISSIONS } from '@techpioasset/domain';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Tone } from '@/components/assets/discovery-tabs';

/**
 * v2.5 H5 — the work-order detail. Assignment with SLA, diagnosis, hold and
 * resume, and part draw through the v2.4 guarded stock (a refused draw shows
 * the honest numbers, and nothing moves).
 */

interface PartRow {
  id: string;
  quantity: string;
  reason: string | null;
  createdAt: string;
  inventoryItem: { id: string; sku: string; name: string; unit: string };
}

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
  technicianId: string | null;
  slaDueAt: string | null;
  escalatedAt: string | null;
  diagnosis: string | null;
  serviceCost?: string | null;
  downtimeHours?: string | null;
  asset: { id: string; assetTag: string; name: string; status: string } | null;
  vendor: { id: string; name: string } | null;
  parts: PartRow[];
}

interface UserRow {
  id: string;
  email: string;
  profile: { firstName: string; lastName: string } | null;
}

interface StockItem {
  id: string;
  sku: string;
  name: string;
}

interface StockLocation {
  id: string;
  code: string;
  name: string;
}

const STATUS_TONE: Record<string, string> = {
  REQUESTED: 'neutral',
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  ON_HOLD: 'neutral',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  FAILED: 'critical',
};

function userName(u: UserRow): string {
  return u.profile ? `${u.profile.firstName} ${u.profile.lastName}` : u.email;
}

export default function MaintenanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.MAINTENANCE_MANAGE);
  const canPickPeople = can(PERMISSIONS.EMPLOYEES_READ);
  const canPickStock = can(PERMISSIONS.INVENTORY_READ);

  const [cost, setCost] = useState('');
  const [downtime, setDowntime] = useState('');
  const [notes, setNotes] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [slaDueAt, setSlaDueAt] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [holdReason, setHoldReason] = useState('');
  const [partItemId, setPartItemId] = useState('');
  const [partLocationId, setPartLocationId] = useState('');
  const [partQty, setPartQty] = useState('1');
  const [partError, setPartError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['maintenance', id],
    queryFn: () => apiFetch<MaintenanceDetail>(`/maintenance/${id}`),
  });

  const { data: people } = useQuery({
    queryKey: ['people-picker'],
    queryFn: () => apiFetchPage<UserRow>('/users?pageSize=100'),
    enabled: canManage && canPickPeople,
    staleTime: 60_000,
  });
  const { data: items } = useQuery({
    queryKey: ['stock-items'],
    queryFn: () => apiFetch<StockItem[]>('/stock/items'),
    enabled: canManage && canPickStock,
    staleTime: 60_000,
  });
  const { data: locations } = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => apiFetch<StockLocation[]>('/stock/locations'),
    enabled: canManage && canPickStock,
    staleTime: 60_000,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['maintenance', id] });
    await queryClient.invalidateQueries({ queryKey: ['maintenance'] });
  };

  const act = useMutation({
    mutationFn: (input: { action: string; method?: 'POST' | 'PATCH'; body?: unknown }) =>
      apiFetch(`/maintenance/${id}/${input.action}`, {
        method: input.method ?? 'POST',
        body: input.body ?? {},
      }),
    onSuccess: () => void refresh(),
    onError: (caught) =>
      toast.error(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'The action failed.',
      ),
  });

  const drawPart = useMutation({
    mutationFn: () =>
      apiFetch(`/maintenance/${id}/consume-part`, {
        method: 'POST',
        body: {
          inventoryItemId: partItemId,
          stockLocationId: partLocationId,
          quantity: Number(partQty),
        },
      }),
    onSuccess: () => {
      setPartError(null);
      setPartQty('1');
      toast.success('Part drawn from stock.');
      void refresh();
    },
    onError: (caught) => {
      const message =
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not draw the part.';
      setPartError(message);
    },
  });

  if (isPending) return <Skeleton className="h-80" />;
  if (isError)
    return <ErrorState title="Could not load this record" detail={(error as Error).message} />;

  const open = !['COMPLETED', 'CANCELLED', 'FAILED'].includes(data.status);
  const slaOverdue = data.slaDueAt != null && new Date(data.slaDueAt).getTime() < Date.now() && open;
  const technician = people?.data.find((u) => u.id === data.technicianId);

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">{data.title}</h1>
          <Tone tone={STATUS_TONE[data.status] ?? 'neutral'}>
            {data.status.replace(/_/g, ' ').toLowerCase()}
          </Tone>
          {slaOverdue ? (
            <Tone tone="critical">
              <AlertTriangle aria-hidden="true" className="mr-1 size-3" />
              SLA overdue{data.escalatedAt ? ' · escalated' : ''}
            </Tone>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {data.type}
          {data.asset ? (
            <>
              {' · '}
              <Link href={`/assets/${data.asset.id}`} className="hover:underline">
                {data.asset.assetTag}
              </Link>
            </>
          ) : null}
          {data.slaDueAt ? ` · due ${new Date(data.slaDueAt).toLocaleDateString()}` : ''}
          {data.technicianId
            ? ` · ${technician ? userName(technician) : 'assigned'}`
            : ' · unassigned'}
        </p>
      </header>

      {data.description ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="mt-2 text-sm text-[var(--color-content-muted)]">{data.description}</p>
        </Card>
      ) : null}

      {data.diagnosis ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Diagnosis</h2>
          <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-content-muted)]">
            {data.diagnosis}
          </p>
        </Card>
      ) : null}

      {data.parts.length > 0 ? (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Parts used</h2>
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {data.parts.map((part) => (
              <li key={part.id} className="flex items-baseline justify-between py-2 text-sm">
                <span>
                  {part.inventoryItem.name}
                  <span className="text-xs text-[var(--color-content-subtle)]">
                    {' '}
                    · {part.inventoryItem.sku}
                  </span>
                  {part.reason ? (
                    <span className="block text-xs text-[var(--color-content-subtle)]">
                      {part.reason}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums">
                  {Number(part.quantity)} {part.inventoryItem.unit}
                </span>
              </li>
            ))}
          </ul>
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
      ) : null}

      {open && canManage ? (
        <>
          <Card className="grid gap-3 p-5">
            <h2 className="text-sm font-semibold">Assignment &amp; SLA</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Technician" htmlFor="wo-tech">
                <select
                  id="wo-tech"
                  value={technicianId || (data.technicianId ?? '')}
                  onChange={(e) => setTechnicianId(e.target.value)}
                  className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                >
                  <option value="">Choose…</option>
                  {people?.data.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userName(u)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="SLA deadline" htmlFor="wo-sla">
                <Input
                  id="wo-sla"
                  type="date"
                  value={slaDueAt}
                  onChange={(e) => setSlaDueAt(e.target.value)}
                />
              </Field>
            </div>
            <Button
              size="sm"
              className="justify-self-start"
              loading={act.isPending}
              disabled={!(technicianId || data.technicianId)}
              onClick={() =>
                act.mutate({
                  action: 'assign',
                  body: {
                    technicianId: technicianId || data.technicianId,
                    ...(slaDueAt ? { slaDueAt: new Date(slaDueAt).toISOString() } : {}),
                  },
                })
              }
            >
              {data.technicianId ? 'Reassign' : 'Assign'}
            </Button>
          </Card>

          <Card className="grid gap-3 p-5">
            <h2 className="text-sm font-semibold">Diagnosis</h2>
            <textarea
              rows={3}
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder={data.diagnosis ?? 'What did you find?'}
              aria-label="Diagnosis"
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2.5 text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              className="justify-self-start"
              loading={act.isPending}
              disabled={!diagnosis.trim()}
              onClick={() =>
                act.mutate({ action: 'diagnosis', method: 'PATCH', body: { diagnosis } })
              }
            >
              Save diagnosis
            </Button>
          </Card>

          {data.status === 'IN_PROGRESS' || data.status === 'ON_HOLD' ? (
            <Card className="grid gap-3 p-5">
              <h2 className="text-sm font-semibold">Draw a part from stock</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Part" htmlFor="wo-part">
                  <select
                    id="wo-part"
                    value={partItemId}
                    onChange={(e) => setPartItemId(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                  >
                    <option value="">Choose…</option>
                    {items?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.sku})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="From location" htmlFor="wo-loc">
                  <select
                    id="wo-loc"
                    value={partLocationId}
                    onChange={(e) => setPartLocationId(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                  >
                    <option value="">Choose…</option>
                    {locations?.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.code} — {loc.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity" htmlFor="wo-qty">
                  <Input
                    id="wo-qty"
                    inputMode="numeric"
                    value={partQty}
                    onChange={(e) => setPartQty(e.target.value)}
                  />
                </Field>
              </div>
              {partError ? (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                  style={{
                    color: 'var(--tone-critical-fg)',
                    backgroundColor: 'var(--tone-critical-bg)',
                    borderColor: 'var(--tone-critical-border)',
                  }}
                >
                  {partError}
                </p>
              ) : null}
              <Button
                size="sm"
                className="justify-self-start"
                loading={drawPart.isPending}
                disabled={!partItemId || !partLocationId || !/^\d+$/.test(partQty)}
                onClick={() => drawPart.mutate()}
              >
                Draw part
              </Button>
            </Card>
          ) : null}

          <Card className="grid gap-4 p-5">
            <h2 className="text-sm font-semibold">Actions</h2>

            {data.status === 'REQUESTED' || data.status === 'SCHEDULED' ? (
              <Button
                size="sm"
                className="justify-self-start"
                loading={act.isPending}
                onClick={() => act.mutate({ action: 'start' })}
              >
                Start work
              </Button>
            ) : null}

            {data.status === 'ON_HOLD' ? (
              <Button
                size="sm"
                className="justify-self-start"
                loading={act.isPending}
                onClick={() => act.mutate({ action: 'resume' })}
              >
                Resume work
              </Button>
            ) : null}

            {data.status === 'IN_PROGRESS' ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Hold reason (optional)" htmlFor="wo-hold">
                    <Input
                      id="wo-hold"
                      value={holdReason}
                      onChange={(e) => setHoldReason(e.target.value)}
                      placeholder="Waiting for a part…"
                      className="w-64"
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={act.isPending}
                    onClick={() =>
                      act.mutate({
                        action: 'hold',
                        body: holdReason ? { reason: holdReason } : {},
                      })
                    }
                  >
                    Put on hold
                  </Button>
                </div>

                <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2">
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
        </>
      ) : null}
    </div>
  );
}
