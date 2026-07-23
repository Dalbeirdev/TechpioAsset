'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Plus } from 'lucide-react';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import {
  ASSET_STATUSES,
  PERMISSIONS,
  type AssetCondition,
  type AssetStatus,
} from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  purchaseCost?: string | null;
  currency?: string | null;
  category: { name: string } | null;
  office: { name: string } | null;
  assignedUser: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
}

function AssetsTable() {
  const params = useSearchParams();
  const { user, can } = useAuth();
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const q = params.get('q') ?? '';

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (q) query.set('q', q);
  if (status) query.set('status', status);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['assets', q, status, page],
    queryFn: () => apiFetchPage<AssetRow>(`/assets?${query.toString()}`),
  });

  // Cost columns are absent from the payload entirely when the caller lacks
  // assets:cost:read, so the header is driven by the data rather than a guess.
  const showCost = Boolean(data?.data.some((row) => 'purchaseCost' in row));

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Assets</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {user?.scope === 'OWN'
              ? 'Assets assigned to you.'
              : q
                ? `Results for “${q}”.`
                : 'Everything you are permitted to see.'}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">All statuses</option>
              {ASSET_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ASSET_STATUS_TOKENS[value].label}
                </option>
              ))}
            </select>
          </label>
          {can(PERMISSIONS.ASSETS_IMPORT) ? (
            <Link
              href="/assets/import"
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              <FileSpreadsheet aria-hidden="true" className="size-4" />
              Import Excel
            </Link>
          ) : null}
          {can(PERMISSIONS.ASSETS_CREATE) ? (
            <Link
              href="/assets/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add asset
            </Link>
          ) : null}
        </div>
      </header>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load assets" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No assets found"
            description={
              q || status
                ? 'Try clearing the search or status filter.'
                : 'Nothing has been assigned to you yet.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Assets, {data.meta.page.totalItems} in total, page {data.meta.page.page} of{' '}
                {data.meta.page.totalPages}
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Asset
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Condition
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Assigned to
                  </th>
                  {showCost ? (
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Cost
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((asset) => (
                  <tr key={asset.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/assets/${asset.id}`} className="font-medium hover:underline">
                        {asset.name}
                      </Link>
                      <p className="text-xs text-[var(--color-content-subtle)]">
                        {asset.assetTag}
                        {asset.serialNumber ? ` · ${asset.serialNumber}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {asset.category?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge token={ASSET_STATUS_TOKENS[asset.status]} size="sm" />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge
                        token={CONDITION_TOKENS[asset.condition]}
                        size="sm"
                        showIcon={false}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {asset.assignedUser?.profile
                        ? `${asset.assignedUser.profile.firstName} ${asset.assignedUser.profile.lastName}`
                        : (asset.assignedUser?.email ?? '—')}
                    </td>
                    {showCost ? (
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {asset.purchaseCost
                          ? `${asset.currency ?? ''} ${Number(asset.purchaseCost).toLocaleString()}`
                          : '—'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.meta.page.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {data.meta.page.page} of {data.meta.page.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export default function AssetsPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <AssetsTable />
    </Suspense>
  );
}
