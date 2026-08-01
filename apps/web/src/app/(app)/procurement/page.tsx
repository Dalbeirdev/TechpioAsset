'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { PO_STATUS_TONE, PR_STATUS_TONE, TonePill, fmtDate } from '@/components/procurement/shared';

interface PrRow {
  id: string;
  prNumber: string;
  status: string;
  justification: string;
  estimatedTotal: string | null;
  createdAt: string;
  requester: { email: string; profile: { firstName: string; lastName: string } | null };
}
interface PoRow {
  id: string;
  poNumber: string;
  status: string;
  issuedDate: string | null;
  total: string;
  currency: string;
  vendor: { name: string } | null;
}

export default function ProcurementPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'requests' | 'orders'>('requests');

  const prs = useQuery({
    queryKey: ['purchase-requests'],
    queryFn: () => apiFetchPage<PrRow>('/procurement/requests?pageSize=100'),
    enabled: tab === 'requests',
  });
  const pos = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => apiFetchPage<PoRow>('/procurement/orders?pageSize=100'),
    enabled: tab === 'orders' && can(PERMISSIONS.PURCHASE_ORDERS_READ),
  });

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
            Purchasing
          </span>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
            <ShoppingCart className="size-6 text-[var(--color-brand)]" /> Procurement
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Request → approval → order → goods receipt, with the three-way match watching the bills.
          </p>
        </div>
        <Link
          href="/procurement/requests/new"
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] shadow-sm transition hover:bg-[var(--color-brand-hover)]"
        >
          <Plus className="size-4" /> New request
        </Link>
      </header>

      <div role="tablist" aria-label="Procurement sections" className="flex gap-1 border-b border-[var(--color-border)]">
        {(
          [
            ['requests', 'Requests'],
            ...(can(PERMISSIONS.PURCHASE_ORDERS_READ) ? [['orders', 'Orders'] as const] : []),
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-transparent text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'requests' ? (
        prs.isPending ? (
          <Skeleton className="h-64" />
        ) : prs.isError ? (
          <ErrorState title="Could not load requests" detail={(prs.error as Error).message} />
        ) : prs.data.data.length === 0 ? (
          <Card className="p-8">
            <EmptyState title="No purchase requests" description="Raise one and it routes to an approver." />
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                  <th className="px-4 py-3 font-semibold">Request</th>
                  <th className="px-4 py-3 font-semibold">Requester</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Estimate</th>
                  <th className="px-4 py-3 font-semibold">Raised</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {prs.data.data.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-3">
                      <Link href={`/procurement/requests/${r.id}`} className="font-medium hover:underline">
                        {r.prNumber}
                      </Link>
                      <p className="max-w-md truncate text-xs text-[var(--color-content-subtle)]">
                        {r.justification}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-content-muted)]">
                      {r.requester.profile
                        ? `${r.requester.profile.firstName} ${r.requester.profile.lastName}`
                        : r.requester.email}
                    </td>
                    <td className="px-4 py-3">
                      <TonePill label={r.status} tone={PR_STATUS_TONE[r.status] ?? 'neutral'} />
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {r.estimatedTotal ? Number(r.estimatedTotal).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-content-muted)]">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : pos.isPending ? (
        <Skeleton className="h-64" />
      ) : pos.isError ? (
        <ErrorState title="Could not load orders" detail={(pos.error as Error).message} />
      ) : (pos.data?.data.length ?? 0) === 0 ? (
        <Card className="p-8">
          <EmptyState title="No purchase orders" description="Convert an approved request to create one." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Vendor</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Issued</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {pos.data!.data.map((o) => (
                <tr key={o.id} className="hover:bg-[var(--color-surface-sunken)]">
                  <td className="px-4 py-3">
                    <Link href={`/procurement/orders/${o.id}`} className="font-medium hover:underline">
                      {o.poNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-content-muted)]">{o.vendor?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <TonePill label={o.status} tone={PO_STATUS_TONE[o.status] ?? 'neutral'} />
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {Number(o.total).toLocaleString()} {o.currency}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-content-muted)]">{fmtDate(o.issuedDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
