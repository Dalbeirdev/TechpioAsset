'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Plus, X } from 'lucide-react';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import {
  ASSET_STATUSES,
  PERMISSIONS,
  type AssetCondition,
  type AssetStatus,
} from '@techpioasset/domain';
import type { BulkActionResult } from '@techpioasset/contracts';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';

// Statuses that destroy or retire an asset — a bulk change to one asks first.
const DESTRUCTIVE_STATUSES = new Set(['RETIRED', 'DISPOSED', 'DONATED', 'LOST', 'STOLEN']);

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
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>('');
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

  // Bulk actions are for roles that can update assets. Selection is per-page and
  // clears whenever the visible set changes so you never act on unseen rows.
  const canBulk = can(PERMISSIONS.ASSETS_UPDATE);
  useEffect(() => {
    setSelected(new Set());
  }, [q, status, page]);

  const rows = data?.data ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggleAll = () =>
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = useMutation({
    mutationFn: (input: { ids: string[]; status: string }) =>
      apiFetch<BulkActionResult>('/assets/bulk/status', { method: 'POST', body: input }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      setSelected(new Set());
      setBulkStatus('');
      const label = ASSET_STATUS_TOKENS[bulkStatus as AssetStatus]?.label ?? 'updated';
      if (result.failed.length === 0) {
        toast.success(`${result.succeeded.length} asset(s) set to ${label}`);
      } else if (result.succeeded.length === 0) {
        toast.error(`None updated — ${result.failed.length} couldn’t change to ${label}`);
      } else {
        toast.info(
          `${result.succeeded.length} set to ${label}; ${result.failed.length} skipped (invalid change)`,
        );
      }
    },
    onError: () => toast.error('Bulk update failed'),
  });

  const applyBulk = async () => {
    if (!bulkStatus || selected.size === 0) return;
    const label = ASSET_STATUS_TOKENS[bulkStatus as AssetStatus]?.label ?? bulkStatus;
    if (DESTRUCTIVE_STATUSES.has(bulkStatus)) {
      const ok = await confirm({
        title: `Set ${selected.size} asset(s) to ${label}?`,
        body: 'This changes each asset’s lifecycle status. Assets where the change isn’t valid will be skipped.',
        confirmLabel: label,
        destructive: true,
      });
      if (!ok) return;
    }
    bulk.mutate({ ids: [...selected], status: bulkStatus });
  };

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

      {canBulk && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-brand)] bg-[var(--color-brand-subtle,var(--color-surface-sunken))] px-4 py-2.5">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="bulk-status">
              Set status for selected assets
            </label>
            <select
              id="bulk-status"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">Set status to…</option>
              {ASSET_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ASSET_STATUS_TOKENS[value].label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!bulkStatus || bulk.isPending}
              loading={bulk.isPending}
              onClick={applyBulk}
            >
              Apply
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              aria-label="Clear selection"
              className="grid size-8 place-items-center rounded-[var(--radius-control)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface)]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        </div>
      ) : null}

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
                  {canBulk ? (
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                        className="size-4 rounded border-[var(--color-border-strong)] align-middle"
                      />
                    </th>
                  ) : null}
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
                  <tr
                    key={asset.id}
                    className={
                      selected.has(asset.id)
                        ? 'bg-[var(--color-surface-sunken)]'
                        : 'hover:bg-[var(--color-surface-sunken)]'
                    }
                  >
                    {canBulk ? (
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${asset.name}`}
                          checked={selected.has(asset.id)}
                          onChange={() => toggleOne(asset.id)}
                          className="size-4 rounded border-[var(--color-border-strong)] align-middle"
                        />
                      </td>
                    ) : null}
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
