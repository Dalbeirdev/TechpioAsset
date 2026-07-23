'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock } from 'lucide-react';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import { PERMISSIONS, type AssetCondition, type AssetStatus } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';

interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
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
}

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
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);
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
    },
    onError: (caught) => {
      setPriceError(
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not record the price.',
      );
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
        <Link
          href="/assets"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> All assets
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{data.name}</h1>
          <StatusBadge token={ASSET_STATUS_TOKENS[data.status]} size="sm" />
        </div>
        <p className="mt-1 text-sm text-[var(--color-content-subtle)]">
          {data.assetTag}
          {data.serialNumber ? ` · SN ${data.serialNumber}` : ''}
        </p>
      </div>

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
      </Card>

      {/* Price — visible to Finance / Super Admin only; recorded once, then locked. */}
      {canSeeCost ? (
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
