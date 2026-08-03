'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend as RechartsLegend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, ErrorState, Skeleton } from '@/components/ui';

/**
 * v2.6 A5 — the exec analytics dashboard. Spend renders ONLY when the caller
 * holds cost visibility (the API refuses regardless — this just avoids asking
 * a question whose answer is always 403). Empty datasets render honestly:
 * "no data in this range", never an invented trend.
 */

interface Overview {
  assetsByStatus: Record<string, number>;
  totals: {
    assets: number;
    activeUsers: number;
    openRequests: number;
    openWorkOrders: number;
    activeLicenses: number;
  };
  health: Record<string, number>;
  discoveryCoveragePct: number | null;
}

interface Spend {
  months: { month: string; assetSpend: number; maintenanceSpend: number }[];
  byCategory: { category: string; assetCount: number; totalCost: number }[];
}

interface Licenses {
  licenses: { id: string; name: string; seatsPurchased: number; seatsReserved: number; utilizationPct: number | null }[];
  runway: Record<string, number>;
}

interface CycleStats {
  count: number;
  avgDays: number | null;
  medianDays: number | null;
  p90Days: number | null;
}

interface Procurement {
  requestsByStatus: Record<string, number>;
  approvalCycle: CycleStats;
  fulfilmentCycle: CycleStats;
}

interface WorkOrders {
  months: { month: string; created: number; completed: number }[];
  openAging: Record<string, number>;
  slaBreachRatePct: number | null;
  repairCycle: CycleStats;
}

const tooltipStyle = {
  contentStyle: {
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: 'var(--color-content)' },
  itemStyle: { color: 'var(--color-content)' },
} as const;

const GRADE_TONE: Record<string, string> = {
  EXCELLENT: 'success',
  GOOD: 'success',
  FAIR: 'warning',
  POOR: 'critical',
  CRITICAL: 'critical',
};

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-[var(--color-content-subtle)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">{hint}</p> : null}
    </Card>
  );
}

function CycleCard({ title, cycle }: { title: string; cycle: CycleStats }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-[var(--color-content-subtle)]">{title}</p>
      {cycle.count === 0 ? (
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">No completed cycles in range.</p>
      ) : (
        <div className="mt-1 flex items-baseline gap-3">
          <p className="text-2xl font-bold tabular-nums">{cycle.medianDays}d</p>
          <p className="text-xs text-[var(--color-content-subtle)]">
            median · avg {cycle.avgDays}d · p90 {cycle.p90Days}d · n={cycle.count}
          </p>
        </div>
      )}
    </Card>
  );
}

export default function AnalyticsPage() {
  const { can } = useAuth();
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);

  const overview = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => apiFetch<Overview>('/analytics/overview'),
  });
  const spend = useQuery({
    queryKey: ['analytics-spend'],
    queryFn: () => apiFetch<Spend>('/analytics/spend?months=12'),
    enabled: canSeeCost,
  });
  const licenses = useQuery({
    queryKey: ['analytics-licenses'],
    queryFn: () => apiFetch<Licenses>('/analytics/licenses'),
  });
  const procurement = useQuery({
    queryKey: ['analytics-procurement'],
    queryFn: () => apiFetch<Procurement>('/analytics/procurement?months=6'),
  });
  const workOrders = useQuery({
    queryKey: ['analytics-work-orders'],
    queryFn: () => apiFetch<WorkOrders>('/analytics/work-orders?months=6'),
  });
  const health = useQuery({
    queryKey: ['analytics-health'],
    queryFn: () => apiFetch<{ grades: Record<string, number>; cappedCount: number; staleCount: number }>('/analytics/health'),
  });

  if (overview.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (overview.isError) {
    return <ErrorState title="Could not load analytics" detail={(overview.error as Error).message} />;
  }

  const o = overview.data;

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          The estate at a glance. Dimensions with no data say so — nothing here is invented.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Assets" value={o.totals.assets} />
        <Tile label="Active people" value={o.totals.activeUsers} />
        <Tile label="Open requests" value={o.totals.openRequests} />
        <Tile label="Open work orders" value={o.totals.openWorkOrders} />
        <Tile
          label="Discovery coverage"
          value={o.discoveryCoveragePct != null ? `${o.discoveryCoveragePct}%` : '—'}
          hint={o.discoveryCoveragePct == null ? 'No assets yet' : 'assets with a hardware profile'}
        />
      </div>

      {canSeeCost ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Spend, last 12 months</h2>
          {spend.isPending ? (
            <Skeleton className="mt-3 h-56" />
          ) : spend.isError ? (
            <ErrorState title="Could not load spend" detail={(spend.error as Error).message} />
          ) : spend.data.months.every((m) => m.assetSpend === 0 && m.maintenanceSpend === 0) ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">
              No recorded spend in this range.
            </p>
          ) : (
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spend.data.months}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }} />
                  <Tooltip {...tooltipStyle} />
                  <RechartsLegend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="assetSpend" name="Asset purchases" stackId="spend" fill="var(--color-brand)" />
                  <Bar dataKey="maintenanceSpend" name="Maintenance" stackId="spend" fill="var(--tone-warning-fg)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Work orders, last 6 months</h2>
          {workOrders.isPending ? (
            <Skeleton className="mt-3 h-48" />
          ) : workOrders.isError ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">Unavailable.</p>
          ) : (
            <>
              <div className="mt-3 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workOrders.data.months}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-content-subtle)' }} />
                    <Tooltip {...tooltipStyle} />
                    <RechartsLegend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="created" name="Raised" fill="var(--tone-info-fg)" />
                    <Bar dataKey="completed" name="Completed" fill="var(--tone-success-fg)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-content-muted)]">
                <span>
                  SLA breach rate:{' '}
                  <strong>
                    {workOrders.data.slaBreachRatePct != null
                      ? `${workOrders.data.slaBreachRatePct}%`
                      : 'no SLAs in range'}
                  </strong>
                </span>
                <span>
                  Open aging:{' '}
                  {Object.entries(workOrders.data.openAging)
                    .map(([bucket, count]) => `${bucket}d: ${count}`)
                    .join(' · ')}
                </span>
              </div>
            </>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Fleet health</h2>
          {health.isPending ? (
            <Skeleton className="mt-3 h-48" />
          ) : health.isError || !health.data ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">Unavailable.</p>
          ) : Object.keys(health.data.grades).length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">
              No health scores yet — discovery has not reported any machines.
            </p>
          ) : (
            <div className="mt-3 grid gap-2">
              {['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL'].map((grade) => {
                const count = health.data.grades[grade] ?? 0;
                const total = Object.values(health.data.grades).reduce((a, b) => a + b, 0);
                const tone = GRADE_TONE[grade] ?? 'neutral';
                return (
                  <div key={grade} className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-3 text-sm">
                    <span className="text-[var(--color-content-muted)]">{grade.toLowerCase()}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: total ? `${(count / total) * 100}%` : 0,
                          backgroundColor: `var(--tone-${tone}-fg)`,
                        }}
                      />
                    </div>
                    <span className="text-right tabular-nums">{count}</span>
                  </div>
                );
              })}
              <p className="mt-1 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-content-subtle)]">
                {health.data.cappedCount} capped at Poor · {health.data.staleCount} stale (&gt;30 days silent)
              </p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">License utilization</h2>
          {licenses.isPending ? (
            <Skeleton className="mt-3 h-40" />
          ) : licenses.isError || licenses.data.licenses.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-content-muted)]">No licenses on record.</p>
          ) : (
            <div className="mt-3 grid gap-2">
              {licenses.data.licenses.slice(0, 8).map((l) => (
                <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_8rem_3rem] items-center gap-3 text-sm">
                  <span className="truncate">{l.name}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-sunken)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${l.utilizationPct ?? 0}%`,
                        backgroundColor:
                          (l.utilizationPct ?? 0) >= 90 ? 'var(--tone-critical-fg)' : 'var(--color-brand)',
                      }}
                    />
                  </div>
                  <span className="text-right text-xs tabular-nums text-[var(--color-content-muted)]">
                    {l.utilizationPct != null ? `${l.utilizationPct}%` : '—'}
                  </span>
                </div>
              ))}
              <p className="mt-1 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-content-subtle)]">
                Expiry runway:{' '}
                {Object.entries(licenses.data.runway)
                  .filter(([, count]) => count > 0)
                  .map(([bucket, count]) => `${bucket}: ${count}`)
                  .join(' · ') || 'nothing expiring'}
              </p>
            </div>
          )}
        </Card>

        <div className="grid content-start gap-3">
          <h2 className="px-1 text-[15px] font-semibold">Procurement cycles, last 6 months</h2>
          {procurement.isPending ? (
            <Skeleton className="h-40" />
          ) : procurement.isError || !procurement.data ? (
            <p className="text-sm text-[var(--color-content-muted)]">Unavailable.</p>
          ) : (
            <>
              <CycleCard title="Submit → approve" cycle={procurement.data.approvalCycle} />
              <CycleCard title="Approve → first receipt" cycle={procurement.data.fulfilmentCycle} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
