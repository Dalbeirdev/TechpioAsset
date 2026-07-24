'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { REQUEST_TYPES } from '@techpioasset/contracts';
import { PERMISSIONS, REQUEST_STATUSES, type RequestStatus } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { downloadCsv } from '@/lib/download-csv';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/status-badge';

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface RequestRow {
  id: string;
  requestNumber: string;
  type: string;
  status: RequestStatus;
  priority: string;
  businessReason: string;
  estimatedCost: string | null;
  currency: string | null;
  createdAt: string;
  requester: { id: string; email: string; profile: { firstName: string; lastName: string } | null };
  items: { id: string; description: string; quantity: string }[];
}

function RequestsTable() {
  const { can } = useAuth();
  const toast = useToast();
  const [awaitingMe, setAwaitingMe] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');

  // Debounce the search box so we query once the user pauses, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (awaitingMe) params.set('awaitingMe', 'true');
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (type) params.set('type', type);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['requests', awaitingMe, page, q, status, type],
    queryFn: () => apiFetchPage<RequestRow>(`/requests?${params.toString()}`),
  });

  const canApprove = can(PERMISSIONS.REQUESTS_APPROVE);
  const hasFilters = q !== '' || status !== '' || type !== '';

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {awaitingMe ? 'Waiting on your decision.' : 'Requests you can see.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canApprove ? (
            <div
              role="radiogroup"
              aria-label="Filter"
              className="inline-flex rounded-[var(--radius-control)] border border-[var(--color-border-strong)] p-0.5"
            >
              {[
                { label: 'All', value: false },
                { label: 'Awaiting me', value: true },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={awaitingMe === option.value}
                  onClick={() => {
                    setAwaitingMe(option.value);
                    setPage(1);
                  }}
                  className={
                    awaitingMe === option.value
                      ? 'rounded-[calc(var(--radius-control)-2px)] bg-[var(--color-brand)] px-3 py-1.5 text-sm text-[var(--color-brand-contrast)]'
                      : 'px-3 py-1.5 text-sm text-[var(--color-content-muted)]'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* A link, not a button with a navigation handler: middle-click and
              "open in new tab" should work. */}
          <Link
            href="/requests/new"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-medium text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
          >
            <Plus aria-hidden="true" className="size-4" />
            New request
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
          />
          <Input
            type="search"
            aria-label="Search requests"
            placeholder="Search by number, item or reason…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {REQUEST_STATUS_TOKENS[value].label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value="">All types</option>
          {REQUEST_TYPES.map((value) => (
            <option key={value} value={value}>
              {titleCase(value)}
            </option>
          ))}
        </select>

        {hasFilters ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('');
              setQ('');
              setStatus('');
              setType('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        ) : null}
        <button
          type="button"
          onClick={async () => {
            const p = new URLSearchParams();
            if (q) p.set('q', q);
            if (status) p.set('status', status);
            if (type) p.set('type', type);
            const ok = await downloadCsv(
              `/requests/export${p.toString() ? `?${p}` : ''}`,
              'requests.csv',
            );
            if (ok) toast.success('Export downloaded');
            else toast.error('Could not export');
          }}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          <Download aria-hidden="true" className="size-4" />
          Export
        </button>
      </div>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load requests" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title={
              hasFilters
                ? 'No matching requests'
                : awaitingMe
                  ? 'Nothing awaiting you'
                  : 'No requests yet'
            }
            description={
              hasFilters
                ? 'No requests match these filters. Try clearing them.'
                : awaitingMe
                  ? 'Requests appear here when they reach a step you approve.'
                  : 'Raise a request for equipment, furniture or supplies.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Requests, {data.meta.page.totalItems} in total</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Request
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Requester
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Estimate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((row) => (
                  <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5">
                      <Link href={`/requests/${row.id}`} className="font-medium hover:underline">
                        {row.requestNumber}
                      </Link>
                      <p className="max-w-md truncate text-xs text-[var(--color-content-subtle)]">
                        {row.items.map((i) => i.description).join(', ')}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {row.requester.profile
                        ? `${row.requester.profile.firstName} ${row.requester.profile.lastName}`
                        : row.requester.email}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge token={REQUEST_STATUS_TOKENS[row.status]} size="sm" />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.estimatedCost
                        ? `${row.currency ?? ''} ${Number(row.estimatedCost).toLocaleString()}`
                        : '—'}
                    </td>
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
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <RequestsTable />
    </Suspense>
  );
}
