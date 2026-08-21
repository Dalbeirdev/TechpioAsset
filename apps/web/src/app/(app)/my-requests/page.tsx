'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import type { RequestStatus } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';

/**
 * The requests YOU raised, whatever your data scope. The profile menu linked
 * here without the page existing. Distinct from /requests on purpose: that
 * list shows what your scope lets you see (for an approver, everyone's);
 * this one answers "where are MY requests?" for every role including the
 * widest, whose scoped list buries their own three requests in the
 * company's three hundred.
 */

interface RequestRow {
  id: string;
  requestNumber: string;
  type: string;
  status: RequestStatus;
  /** The step it is actually on, when it is on one. */
  currentStep: { name: string; kind: string } | null;
  priority: string;
  createdAt: string;
  items: { description: string }[];
}

const TYPE_LABELS: Record<string, string> = {
  NEW_ASSET: 'New asset',
  REPLACEMENT: 'Replacement',
  REPAIR: 'Repair',
  ACCESSORY: 'Accessory',
  SOFTWARE: 'Software',
  RETURN: 'Return',
};

export default function MyRequestsPage() {
  const { user } = useAuth();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['my-requests', user?.id],
    enabled: Boolean(user),
    queryFn: () => apiFetchPage<RequestRow>('/requests?mine=true&pageSize=100'),
  });

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">My requests</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Everything you have asked for, and where it stands.
          </p>
        </div>
        <Link
          href="/requests/new"
          className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-brand-contrast)]"
        >
          New request
        </Link>
      </header>

      {isPending ? (
        <Skeleton className="h-48" />
      ) : isError ? (
        <ErrorState title="Could not load your requests" detail={(error as Error).message} />
      ) : data.data.length === 0 ? (
        <Card>
          <EmptyState
            title="You have not raised any requests"
            description="Need equipment, a repair or software? Raise a request and track it here."
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
                <th className="px-4 py-3 font-medium">Request</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Raised</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-sunken)]"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/requests/${row.id}`}
                      className="font-medium text-[var(--color-brand)]"
                    >
                      {row.requestNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{TYPE_LABELS[row.type] ?? row.type}</td>
                  <td className="max-w-64 truncate px-4 py-2.5 text-[var(--color-content-muted)]">
                    {row.items.map((i) => i.description).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                        token={REQUEST_STATUS_TOKENS[row.status]}
                        size="sm"
                        label={row.currentStep?.name}
                      />
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                    {new Date(row.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
