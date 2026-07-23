'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ASSET_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import type { AssetStatus } from '@techpioasset/domain';
import { apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton, StatTile } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { StatusBarChart } from '@/components/charts/status-bar-chart';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  warrantyEndDate: string | null;
  assignedUser: { id: string; email: string } | null;
  category: { name: string } | null;
}

const DAY = 86_400_000;

export default function DashboardPage() {
  const { user } = useAuth();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['dashboard-assets'],
    // The dashboard reads the same scoped endpoint as everything else, so each
    // role's figures are automatically limited to what that role may see.
    queryFn: () => apiFetchPage<AssetRow>('/assets?pageSize=100'),
  });

  if (isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Could not load the dashboard" detail={(error as Error).message} />;
  }

  const assets = data.data;
  const byStatus = (status: AssetStatus) => assets.filter((a) => a.status === status).length;

  const expiringSoon = assets.filter((asset) => {
    if (!asset.warrantyEndDate) return false;
    const remaining = new Date(asset.warrantyEndDate).getTime() - Date.now();
    return remaining > 0 && remaining <= 30 * DAY;
  });

  const needsAttention = assets.filter((a) =>
    (['UNDER_REPAIR', 'DAMAGED', 'LOST', 'STOLEN'] as AssetStatus[]).includes(a.status),
  );

  // Status distribution for the chart; only statuses actually present, coloured
  // by their shared tone so the chart matches the badges elsewhere.
  const statusData = (Object.keys(ASSET_STATUS_TOKENS) as AssetStatus[])
    .map((status) => ({
      label: ASSET_STATUS_TOKENS[status].label,
      count: byStatus(status),
      fill: `var(--tone-${ASSET_STATUS_TOKENS[status].tone}-solid)`,
    }))
    .filter((d) => d.count > 0);

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          {user?.firstName ? `Welcome back, ${user.firstName}` : 'Dashboard'}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {user?.scope === 'OWN'
            ? 'Assets assigned to you.'
            : user?.scope === 'DIRECT_REPORTS'
              ? 'Assets held by you and your direct reports.'
              : `${data.meta.page.totalItems} assets in your organisation.`}
        </p>
      </header>

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total assets" value={data.meta.page.totalItems} />
        <StatTile label="Available" value={byStatus('AVAILABLE')} tone="success" />
        <StatTile label="Assigned" value={byStatus('ASSIGNED') + byStatus('IN_USE')} tone="info" />
        <StatTile
          label="Need attention"
          value={needsAttention.length}
          tone={needsAttention.length > 0 ? 'warning' : 'neutral'}
          hint="Under repair, damaged, lost or stolen"
        />
      </section>

      <section aria-label="Assets by status">
        <Card>
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Assets by status</h2>
          </div>
          {statusData.length === 0 ? (
            <EmptyState title="No assets yet" description="Nothing to chart." />
          ) : (
            <StatusBarChart data={statusData} />
          )}
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Warranties expiring within 30 days</h2>
            <span className="text-xs text-[var(--color-content-subtle)]">
              {expiringSoon.length}
            </span>
          </div>
          {expiringSoon.length === 0 ? (
            <EmptyState
              title="Nothing expiring soon"
              description="No warranties end in the next 30 days."
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {expiringSoon.slice(0, 6).map((asset) => (
                <li key={asset.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/assets/${asset.id}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {asset.name}
                    </Link>
                    <p className="text-xs text-[var(--color-content-subtle)]">{asset.assetTag}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--tone-warning-fg)]">
                    {Math.ceil(
                      (new Date(asset.warrantyEndDate as string).getTime() - Date.now()) / DAY,
                    )}{' '}
                    days
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold">Needs attention</h2>
            <span className="text-xs text-[var(--color-content-subtle)]">
              {needsAttention.length}
            </span>
          </div>
          {needsAttention.length === 0 ? (
            <EmptyState title="All clear" description="No assets are damaged, lost or in repair." />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {needsAttention.slice(0, 6).map((asset) => (
                <li key={asset.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/assets/${asset.id}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {asset.name}
                    </Link>
                    <p className="text-xs text-[var(--color-content-subtle)]">{asset.assetTag}</p>
                  </div>
                  <StatusBadge token={ASSET_STATUS_TOKENS[asset.status]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
