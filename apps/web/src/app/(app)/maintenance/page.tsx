'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiFetchPage } from '@/lib/api-client';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';

interface MaintenanceRow {
  id: string;
  type: string;
  status: string;
  title: string;
  scheduledFor: string | null;
  completedAt: string | null;
  serviceCost?: string | null;
  asset: { id: string; assetTag: string; name: string } | null;
  vendor: { id: string; name: string } | null;
}

const STATUS_TONE: Record<string, string> = {
  REQUESTED: 'neutral',
  SCHEDULED: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  FAILED: 'critical',
};

export default function MaintenancePage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => apiFetchPage<MaintenanceRow>('/maintenance?pageSize=50'),
  });

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Maintenance</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Repairs, inspections and scheduled service across the estate.
        </p>
      </header>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load maintenance" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No maintenance records"
            description="Repairs and inspections appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Maintenance, {data.meta.page.totalItems} in total
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Work
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Asset
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Scheduled
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((row) => {
                  const tone = STATUS_TONE[row.status] ?? 'neutral';
                  return (
                    <tr key={row.id} className="hover:bg-[var(--color-surface-sunken)]">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/maintenance/${row.id}`}
                          className="font-medium hover:underline"
                        >
                          {row.title}
                        </Link>
                        <p className="text-xs text-[var(--color-content-subtle)]">{row.type}</p>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                        {row.asset?.assetTag ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-flex rounded-full border px-2 py-0.5 text-xs"
                          style={{
                            color: `var(--tone-${tone}-fg)`,
                            backgroundColor: `var(--tone-${tone}-bg)`,
                            borderColor: `var(--tone-${tone}-border)`,
                          }}
                        >
                          {row.status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                        {row.scheduledFor ? new Date(row.scheduledFor).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
