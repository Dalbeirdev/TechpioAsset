'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil } from 'lucide-react';
import {
  ASSET_STATUS_TOKENS,
  CONDITION_TOKENS,
  LIFECYCLE_STATE_TOKENS,
  AVAILABILITY_STATE_TOKENS,
  OWNERSHIP_TYPE_TOKENS,
} from '@techpioasset/ui-tokens';
import {
  PERMISSIONS,
  type AssetCondition,
  type AssetStatus,
  type LifecycleState,
  type AvailabilityState,
  type OwnershipType,
} from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';
import { Breadcrumbs } from '@/components/breadcrumbs';
import {
  HardwareTab,
  HealthTab,
  OsTab,
  SoftwareTab,
  type HardwareProfileDto,
  type HealthDto,
  type OsInfoDto,
} from '@/components/assets/discovery-tabs';

interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  lifecycleState: LifecycleState | null;
  availabilityState: AvailabilityState | null;
  ownershipType: OwnershipType | null;
  purchaseDate: string | null;
  warrantyEndDate: string | null;
  purchaseCost?: string | null;
  currency?: string | null;
  category: { name: string } | null;
  subcategory: { name: string } | null;
  office: { name: string } | null;
  assignedUser: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string; employeeNumber: string | null } | null;
  } | null;
  assignmentDate: string | null;
  notes: string | null;
  assignments: {
    id: string;
    assignedAt: string;
    returnedAt: string | null;
    user: { email: string; profile: { firstName: string; lastName: string } | null } | null;
    assetReturn: { conditionIn: AssetCondition; damageNotes: string | null } | null;
  }[];
  conditionLogs: {
    id: string;
    recordedAt: string;
    previousStatus: AssetStatus | null;
    newStatus: AssetStatus | null;
    previousCondition: AssetCondition | null;
    newCondition: AssetCondition | null;
    reason: string | null;
  }[];
  // v2.5 H4 payload — null/zero until discovery has reported this machine.
  hardwareProfile: HardwareProfileDto | null;
  osInfo: OsInfoDto | null;
  health: HealthDto | null;
  _count: { installedSoftware: number };
}

type AssetTab = 'overview' | 'hardware' | 'os' | 'software' | 'health' | 'history' | 'financials';

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? '—'}</dd>
    </div>
  );
}

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);
  const [tab, setTab] = useState<AssetTab>('overview');
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => apiFetch<AssetDetail>(`/assets/${id}`),
  });

  const recordPrice = useMutation({
    mutationFn: (purchaseCost: string) =>
      apiFetch(`/assets/${id}/price`, { method: 'PATCH', body: { purchaseCost } }),
    onSuccess: () => {
      setPriceError(null);
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
      toast.success('Price recorded and locked');
    },
    onError: (caught) => {
      const message =
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not record the price.';
      setPriceError(message);
      toast.error(message);
    },
  });

  if (isPending) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState title="Could not load the asset" detail={(error as Error).message} />;
  }

  const holder = data.assignedUser;
  const holderName = holder?.profile
    ? `${holder.profile.firstName} ${holder.profile.lastName}`
    : (holder?.email ?? null);

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div>
        <Breadcrumbs items={[{ label: 'Assets', href: '/assets' }, { label: data.assetTag }]} />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
          <StatusBadge token={ASSET_STATUS_TOKENS[data.status]} size="sm" />
          {data.lifecycleState ? (
            <StatusBadge token={LIFECYCLE_STATE_TOKENS[data.lifecycleState]} size="sm" />
          ) : null}
          {data.availabilityState ? (
            <StatusBadge token={AVAILABILITY_STATE_TOKENS[data.availabilityState]} size="sm" />
          ) : null}
          {data.ownershipType ? (
            <StatusBadge
              token={OWNERSHIP_TYPE_TOKENS[data.ownershipType]}
              size="sm"
              showIcon={false}
            />
          ) : null}
          {can(PERMISSIONS.ASSETS_UPDATE) ? (
            <Link
              href={`/assets/${id}/edit`}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              <Pencil aria-hidden="true" className="size-4" />
              Edit
            </Link>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-[var(--color-content-subtle)]">
          {data.assetTag}
          {data.serialNumber ? ` · SN ${data.serialNumber}` : ''}
        </p>
      </div>

      {/* v2.2 Workstream E — tabbed asset detail. */}
      <div
        role="tablist"
        aria-label="Asset detail sections"
        className="flex gap-1 border-b border-[var(--color-border)]"
      >
        {(
          [
            ['overview', 'Overview'],
            ['hardware', 'Hardware'],
            ['os', 'OS & Security'],
            ['software', `Software${data._count.installedSoftware ? ` (${data._count.installedSoftware})` : ''}`],
            ['health', 'Health'],
            ['history', 'History'],
            ...(canSeeCost ? ([['financials', 'Financials']] as const) : []),
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
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <Card className="p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Row label="Category" value={data.category?.name} />
            <Row label="Type" value={data.subcategory?.name} />
            <Row label="Office" value={data.office?.name} />
            <Row label="Brand" value={data.brand} />
            <Row label="Model" value={data.model} />
            <Row
              label="Condition"
              value={
                <StatusBadge token={CONDITION_TOKENS[data.condition]} size="sm" showIcon={false} />
              }
            />
            <Row label="Purchased on" value={fmtDate(data.purchaseDate)} />
            <Row label="Warranty ends" value={fmtDate(data.warrantyEndDate)} />
            <Row
              label="Assigned to"
              value={
                holderName ? (
                  <>
                    {holderName}
                    {holder?.profile?.employeeNumber ? (
                      <span className="text-xs text-[var(--color-content-subtle)]">
                        {' '}
                        · {holder.profile.employeeNumber}
                      </span>
                    ) : null}
                  </>
                ) : (
                  'Unassigned'
                )
              }
            />
          </dl>
          {data.notes ? (
            <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-content-muted)]">
              {data.notes}
            </p>
          ) : null}
        </Card>
      ) : null}

      {tab === 'hardware' ? <HardwareTab hw={data.hardwareProfile} /> : null}
      {tab === 'os' ? <OsTab os={data.osInfo} /> : null}
      {tab === 'software' ? <SoftwareTab assetId={id} /> : null}
      {tab === 'health' ? (
        <HealthTab assetId={id} health={data.health} canRecompute={can(PERMISSIONS.ASSETS_UPDATE)} />
      ) : null}

      {tab === 'history' ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Custody &amp; condition history</h2>
          {data.assignments.length === 0 && data.conditionLogs.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">No history yet.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {data.assignments.map((a) => (
                <li key={`a-${a.id}`} className="flex gap-3 text-sm">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-brand)]" />
                  <span>
                    <span className="font-medium">
                      {a.returnedAt ? 'Returned by ' : 'Assigned to '}
                      {a.user?.profile
                        ? `${a.user.profile.firstName} ${a.user.profile.lastName}`
                        : (a.user?.email ?? 'someone')}
                    </span>
                    <span className="text-[var(--color-content-subtle)]">
                      {' '}
                      · {fmtDate(a.returnedAt ?? a.assignedAt)}
                    </span>
                    {a.assetReturn?.damageNotes ? (
                      <span className="block text-xs text-[var(--tone-warning-fg)]">
                        {a.assetReturn.damageNotes}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
              {data.conditionLogs.map((log) => (
                <li key={`c-${log.id}`} className="flex gap-3 text-sm">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--color-content-subtle)]" />
                  <span>
                    <span className="font-medium">
                      {log.previousStatus && log.newStatus && log.previousStatus !== log.newStatus
                        ? `${log.previousStatus} → ${log.newStatus}`
                        : log.previousCondition && log.newCondition
                          ? `Condition ${log.previousCondition} → ${log.newCondition}`
                          : 'Status change'}
                    </span>
                    <span className="text-[var(--color-content-subtle)]"> · {fmtDate(log.recordedAt)}</span>
                    {log.reason ? (
                      <span className="block text-xs text-[var(--color-content-subtle)]">{log.reason}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      ) : null}

      {/* Price — visible to Finance / Super Admin only; recorded once, then locked. */}
      {tab === 'financials' && canSeeCost ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Price</h2>
          {data.purchaseCost != null ? (
            <div className="mt-2 flex items-center gap-2.5">
              <p className="text-2xl font-bold tracking-tight tabular-nums">
                {Number(data.purchaseCost).toLocaleString()}
                {data.currency ? (
                  <span className="ml-1.5 text-sm font-medium text-[var(--color-content-subtle)]">
                    {data.currency}
                  </span>
                ) : null}
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-1 text-xs font-medium text-[var(--color-content-muted)]">
                <Lock aria-hidden="true" className="size-3" /> Locked
              </span>
            </div>
          ) : (
            <form
              className="mt-3 flex flex-wrap items-start gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^\d+(\.\d{1,2})?$/.test(price)) recordPrice.mutate(price);
                else setPriceError('Enter a plain amount, e.g. 45000 or 45000.50');
              }}
            >
              <div className="grid gap-1">
                <Input
                  inputMode="decimal"
                  placeholder="45000.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  aria-label="Purchase price"
                  className="w-44"
                />
                {priceError ? (
                  <p role="alert" className="text-xs text-[var(--tone-critical-fg)]">
                    {priceError}
                  </p>
                ) : null}
              </div>
              <Button type="submit" loading={recordPrice.isPending}>
                Record price
              </Button>
              <p className="basis-full text-xs text-[var(--color-content-subtle)]">
                Recorded once — it locks after saving and cannot be edited.
              </p>
            </form>
          )}
        </Card>
      ) : null}
    </div>
  );
}
