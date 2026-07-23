'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardList,
  FileBarChart,
  Layers,
  Plus,
  ShieldAlert,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';
import { ASSET_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { PERMISSIONS, type AssetStatus } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { StatusBarChart } from '@/components/charts/status-bar-chart';
import {
  AllocationPie,
  DonutChart,
  Gauge,
  GrowthArea,
  Legend,
  WarrantyTimeline,
} from '@/components/dashboard/charts';

interface AssetRow {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  warrantyEndDate: string | null;
  purchaseDate: string | null;
  category: { name: string } | null;
  office: { name: string } | null;
  assignedUser: { id: string; email: string } | null;
}

const DAY = 86_400_000;
// Distinct, theme-aware series colours (kept legible on both grounds).
const PALETTE = [
  'var(--color-brand)',
  'var(--tone-progress-solid)',
  'var(--tone-info-solid)',
  'var(--tone-success-solid)',
  'var(--tone-warning-solid)',
  'var(--color-content-subtle)',
];
const seriesColor = (i: number): string =>
  PALETTE[i % PALETTE.length] ?? 'var(--color-content-subtle)';

/** One KPI tile — icon, big number, label, and a real sub-line (no fake trends). */
function Kpi({
  icon,
  tone,
  value,
  label,
  sub,
}: {
  icon: ReactNode;
  tone: string;
  value: number;
  label: string;
  sub: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-[18px] shadow-sm transition duration-200 hover:-translate-y-[3px] hover:shadow-md">
      <span
        className="grid size-10 place-items-center rounded-[11px]"
        style={{ color: `var(--tone-${tone}-fg)`, background: `var(--tone-${tone}-bg)` }}
      >
        {icon}
      </span>
      <div className="mt-4 text-[26px] font-bold leading-none tracking-tight tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="mt-2 text-[13px] font-medium text-[var(--color-content-muted)]">{label}</div>
      <div className="mt-0.5 text-xs text-[var(--color-content-subtle)]">{sub}</div>
    </div>
  );
}

const QUICK_ACTIONS = [
  {
    href: '/assets',
    label: 'Browse assets',
    icon: <Boxes className="size-[18px]" />,
    tone: 'info',
  },
  {
    href: '/requests/new',
    label: 'New request',
    icon: <ClipboardList className="size-[18px]" />,
    tone: 'progress',
  },
  {
    href: '/maintenance',
    label: 'Maintenance',
    icon: <Wrench className="size-[18px]" />,
    tone: 'warning',
  },
  { href: '/people', label: 'People', icon: <Users className="size-[18px]" />, tone: 'success' },
  {
    href: '/invoices/upload',
    label: 'Upload invoice',
    icon: <Upload className="size-[18px]" />,
    tone: 'neutral',
  },
  {
    href: '/reports',
    label: 'Run report',
    icon: <FileBarChart className="size-[18px]" />,
    tone: 'danger',
  },
];

interface SpendReport {
  rows: { name: string; count: number; total: number }[];
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const canSeeSpend = can(PERMISSIONS.ASSETS_COST_READ);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['dashboard-assets'],
    // Scoped like everything else, so each role's dashboard reflects only what
    // that role may see.
    queryFn: () => apiFetchPage<AssetRow>('/assets?pageSize=100'),
  });

  // Total spend by category — server-aggregated over ALL assets, and only ever
  // requested for roles that may see cost (Finance / Super Admin).
  const spend = useQuery({
    queryKey: ['dashboard-spend'],
    enabled: canSeeSpend,
    queryFn: () => apiFetch<SpendReport>('/reports?type=SPENDING_BY_CATEGORY'),
  });

  if (isPending) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Could not load the dashboard" detail={(error as Error).message} />;
  }

  const assets = data.data;
  const total = data.meta.page.totalItems;
  const count = (s: AssetStatus) => assets.filter((a) => a.status === s).length;

  const available = count('AVAILABLE');
  const assigned = count('ASSIGNED') + count('IN_USE');
  const underRepair = count('UNDER_REPAIR');
  const critical = (['DAMAGED', 'LOST', 'STOLEN'] as AssetStatus[]).reduce(
    (n, s) => n + count(s),
    0,
  );
  const retired = (['RETIRED', 'DISPOSED'] as AssetStatus[]).reduce((n, s) => n + count(s), 0);
  const pct = (n: number) => (assets.length ? Math.round((n / assets.length) * 100) : 0);

  // Operational health: everything not out of service.
  const operational = assets.length
    ? Math.round(((assets.length - underRepair - critical - retired) / assets.length) * 100)
    : 100;

  // Warranty buckets (upcoming expiries).
  const now = Date.now();
  let w30 = 0,
    w60 = 0,
    w90 = 0,
    covered = 0;
  for (const a of assets) {
    if (!a.warrantyEndDate) {
      covered += 1;
      continue;
    }
    const days = Math.ceil((new Date(a.warrantyEndDate).getTime() - now) / DAY);
    if (days < 0) continue;
    else if (days <= 30) w30 += 1;
    else if (days <= 60) w60 += 1;
    else if (days <= 90) w90 += 1;
    else covered += 1;
  }
  const inMonths = (m: number) =>
    new Date(now + m * 30 * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  // Distribution by category and allocation by office.
  const groupTop = (key: (a: AssetRow) => string | null) => {
    const map = new Map<string, number>();
    for (const a of assets) {
      const k = key(a) ?? 'Unassigned';
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((n, [, v]) => n + v, 0);
    const rows = top.map(([name, value], i) => ({ name, value, fill: seriesColor(i) }));
    if (rest > 0) rows.push({ name: 'Other', value: rest, fill: seriesColor(5) });
    return rows;
  };
  const byCategory = groupTop((a) => a.category?.name ?? null);
  const byOffice = groupTop((a) => a.office?.name ?? null);

  // Cumulative growth from purchase dates (real time series).
  const monthCounts = new Map<string, number>();
  for (const a of assets) {
    if (!a.purchaseDate) continue;
    const d = new Date(a.purchaseDate);
    monthCounts.set(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      (monthCounts.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) ?? 0) + 1,
    );
  }
  let running = 0;
  const growth = [...monthCounts.keys()]
    .sort()
    .map((m) => {
      running += monthCounts.get(m) ?? 0;
      const [y, mo] = m.split('-');
      return {
        label: new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, {
          month: 'short',
        }),
        value: running,
      };
    })
    .slice(-12);

  // Status distribution (for the bar chart).
  const statusData = (Object.keys(ASSET_STATUS_TOKENS) as AssetStatus[])
    .map((s) => ({
      label: ASSET_STATUS_TOKENS[s].label,
      count: count(s),
      fill: `var(--tone-${ASSET_STATUS_TOKENS[s].tone}-solid)`,
    }))
    .filter((d) => d.count > 0);

  // Data-derived recommendations (rule-based, not an LLM — labelled honestly).
  const recs = [
    w30 > 0 && {
      tone: 'danger',
      title: 'Plan warranty renewals',
      body: `${w30} asset${w30 === 1 ? '' : 's'} fall out of warranty within 30 days. Review coverage before it lapses.`,
      href: '/reports',
      cta: 'Open warranty report',
    },
    underRepair > 0 && {
      tone: 'warning',
      title: 'Repairs in progress',
      body: `${underRepair} asset${underRepair === 1 ? '' : 's'} under repair. Check turnaround on the maintenance board.`,
      href: '/maintenance',
      cta: 'Open maintenance',
    },
    available > 0 && {
      tone: 'info',
      title: 'Idle inventory',
      body: `${available} available asset${available === 1 ? '' : 's'} unassigned. Reallocate to clear open requests.`,
      href: '/assets',
      cta: 'View available',
    },
    critical > 0 && {
      tone: 'critical',
      title: 'Critical assets',
      body: `${critical} asset${critical === 1 ? '' : 's'} damaged, lost or stolen. Investigate and update status.`,
      href: '/assets',
      cta: 'Review assets',
    },
  ]
    .filter(Boolean)
    .slice(0, 3) as {
    tone: string;
    title: string;
    body: string;
    href: string;
    cta: string;
  }[];

  const expiringSoon = assets
    .filter((a) => {
      if (!a.warrantyEndDate) return false;
      const remaining = new Date(a.warrantyEndDate).getTime() - now;
      return remaining > 0 && remaining <= 30 * DAY;
    })
    .slice(0, 6);

  const needsAttention = assets
    .filter((a) =>
      (['UNDER_REPAIR', 'DAMAGED', 'LOST', 'STOLEN'] as AssetStatus[]).includes(a.status),
    )
    .slice(0, 6);

  return (
    <div className="grid gap-5">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
            Overview
          </span>
          <h1 className="mt-1 text-[24px] font-bold tracking-tight">
            {user?.firstName ? `Welcome back, ${user.firstName}` : 'Asset command center'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {user?.scope === 'OWN'
              ? 'Assets assigned to you.'
              : user?.scope === 'DIRECT_REPORTS'
                ? 'Assets held by you and your direct reports.'
                : `${total.toLocaleString()} assets under management · ${critical + underRepair} need attention.`}
          </p>
        </div>
        {can(PERMISSIONS.ASSETS_CREATE) ? (
          <Link
            href="/assets/new"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] shadow-sm transition hover:bg-[var(--color-brand-hover)] hover:shadow-md"
          >
            <Plus className="size-4" /> Add asset
          </Link>
        ) : null}
      </header>

      {/* KPIs */}
      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          icon={<Boxes className="size-[21px]" />}
          tone="info"
          value={total}
          label="Total assets"
          sub={`${byOffice.length} office${byOffice.length === 1 ? '' : 's'}`}
        />
        <Kpi
          icon={<CheckCircle2 className="size-[21px]" />}
          tone="success"
          value={available}
          label="Available"
          sub={`${pct(available)}% of fleet`}
        />
        <Kpi
          icon={<Users className="size-[21px]" />}
          tone="progress"
          value={assigned}
          label="Assigned"
          sub={`${pct(assigned)}% of fleet`}
        />
        <Kpi
          icon={<Wrench className="size-[21px]" />}
          tone="warning"
          value={underRepair}
          label="Under repair"
          sub="in service"
        />
        <Kpi
          icon={<ShieldAlert className="size-[21px]" />}
          tone="danger"
          value={w30}
          label="Warranty expiring"
          sub="within 30 days"
        />
        <Kpi
          icon={<AlertTriangle className="size-[21px]" />}
          tone="critical"
          value={critical}
          label="Critical alerts"
          sub="damaged / lost / stolen"
        />
      </section>

      {/* Total spend — Finance / Super Admin only */}
      {canSeeSpend && spend.data && spend.data.rows.length > 0 ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-[15px] font-semibold">Total spend</h3>
              <p className="text-xs text-[var(--color-content-subtle)]">
                Purchase cost on record, by equipment category
              </p>
              <p className="mt-2 text-[28px] font-bold tracking-tight tabular-nums">
                {spend.data.rows
                  .reduce((sum, r) => sum + r.total, 0)
                  .toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="grid min-w-[260px] flex-1 gap-1.5 sm:max-w-md">
              {spend.data.rows.slice(0, 5).map((r) => {
                const grand = spend.data.rows.reduce((s, x) => s + x.total, 0) || 1;
                const pctOf = Math.round((r.total / grand) * 100);
                return (
                  <div key={r.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-[var(--color-content-muted)]">
                        {r.name}{' '}
                        <span className="text-xs text-[var(--color-content-subtle)]">
                          · {r.count}
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums">
                        {r.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="col-span-2 h-1.5 rounded-full bg-[var(--color-surface-sunken)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-brand)]"
                        style={{ width: `${pctOf}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Charts row A */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-semibold">Asset distribution</h3>
              <p className="text-xs text-[var(--color-content-subtle)]">By category</p>
            </div>
          </div>
          {byCategory.length === 0 ? (
            <EmptyState title="No assets" description="Nothing to chart yet." />
          ) : (
            <div className="flex items-center gap-5">
              <DonutChart
                data={byCategory}
                centerValue={total.toLocaleString()}
                centerLabel="assets"
              />
              <Legend
                items={byCategory.map((s) => ({
                  name: s.name,
                  value: s.value.toLocaleString(),
                  fill: s.fill,
                }))}
              />
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-semibold">Asset growth</h3>
              <p className="text-xs text-[var(--color-content-subtle)]">
                Cumulative devices by purchase date
              </p>
            </div>
          </div>
          {growth.length === 0 ? (
            <EmptyState title="No purchase dates" description="Growth needs dated purchases." />
          ) : (
            <GrowthArea data={growth} />
          )}
        </Card>
      </section>

      {/* Charts row B */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-2">
            <h3 className="text-[15px] font-semibold">Fleet health</h3>
            <p className="text-xs text-[var(--color-content-subtle)]">Assets in service</p>
          </div>
          <Gauge
            percent={operational}
            label={`Operational · ${assets.length - underRepair - critical - retired} devices`}
          />
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-[15px] font-semibold">Office allocation</h3>
            <p className="text-xs text-[var(--color-content-subtle)]">Where assets live</p>
          </div>
          {byOffice.length === 0 ? (
            <EmptyState title="No offices" description="No allocation to show." />
          ) : (
            <div className="flex items-center gap-5">
              <AllocationPie data={byOffice} />
              <Legend
                items={byOffice.map((s) => ({
                  name: s.name,
                  pct: `${pct(s.value)}%`,
                  fill: s.fill,
                }))}
              />
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-2">
            <h3 className="text-[15px] font-semibold">Assets by status</h3>
            <p className="text-xs text-[var(--color-content-subtle)]">Lifecycle state</p>
          </div>
          {statusData.length === 0 ? (
            <EmptyState title="No assets" description="Nothing to chart." />
          ) : (
            <StatusBarChart data={statusData} />
          )}
        </Card>
      </section>

      {/* Warranty timeline */}
      <Card className="p-5">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h3 className="text-[15px] font-semibold">Warranty expiry timeline</h3>
            <p className="text-xs text-[var(--color-content-subtle)]">
              Coverage ending in the next 90 days — plan renewals ahead
            </p>
          </div>
          <Link href="/reports" className="text-[13px] font-semibold text-[var(--color-brand)]">
            Renewal report
          </Link>
        </div>
        <WarrantyTimeline
          buckets={[
            {
              count: w30,
              label: 'Expiring ≤ 30 days',
              when: `by ${inMonths(1)}`,
              color: 'var(--tone-critical-solid)',
            },
            {
              count: w60,
              label: '31 – 60 days',
              when: `by ${inMonths(2)}`,
              color: 'var(--tone-warning-solid)',
            },
            {
              count: w90,
              label: '61 – 90 days',
              when: `by ${inMonths(3)}`,
              color: 'var(--color-brand)',
            },
            {
              count: covered,
              label: 'Covered / no expiry',
              when: 'healthy',
              color: 'var(--tone-success-solid)',
            },
          ]}
        />
      </Card>

      {/* Widgets */}
      <section className="grid gap-4 lg:grid-cols-3">
        {/* Recommendations */}
        <Card className="p-5">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-semibold">Recommendations</h3>
              <p className="text-xs text-[var(--color-content-subtle)]">From your live inventory</p>
            </div>
          </div>
          {recs.length === 0 ? (
            <EmptyState title="All clear" description="No actions recommended right now." />
          ) : (
            <div className="grid gap-2.5">
              {recs.map((r) => (
                <Link
                  key={r.title}
                  href={r.href}
                  className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 transition hover:-translate-y-px hover:border-[var(--color-border-strong)]"
                >
                  <span
                    className="inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      color: `var(--tone-${r.tone}-fg)`,
                      background: `var(--tone-${r.tone}-bg)`,
                    }}
                  >
                    {r.title}
                  </span>
                  <p className="mt-2 text-[13.5px] leading-snug">{r.body}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-brand)]">
                    {r.cta} <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Quick actions */}
        <Card className="p-5">
          <h3 className="mb-4 text-[15px] font-semibold">Quick actions</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {QUICK_ACTIONS.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-[13.5px] font-semibold transition hover:-translate-y-0.5 hover:border-[var(--color-brand)] hover:bg-[var(--color-surface)] hover:shadow-sm"
              >
                <span
                  className="grid size-9 place-items-center rounded-[9px]"
                  style={{
                    color: `var(--tone-${a.tone}-fg)`,
                    background: `var(--tone-${a.tone}-bg)`,
                  }}
                >
                  {a.icon}
                </span>
                {a.label}
              </Link>
            ))}
          </div>
        </Card>

        {/* Attention list */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <div>
              <h3 className="text-[15px] font-semibold">Needs attention</h3>
              <p className="text-xs text-[var(--color-content-subtle)]">Repair, damaged, lost</p>
            </div>
            <Layers className="size-4 text-[var(--color-content-subtle)]" />
          </div>
          {needsAttention.length === 0 ? (
            <EmptyState title="All clear" description="No assets need attention." />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {needsAttention.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/assets/${a.id}`}
                      className="truncate text-[13.5px] font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                    <p className="text-xs text-[var(--color-content-subtle)]">{a.assetTag}</p>
                  </div>
                  <StatusBadge token={ASSET_STATUS_TOKENS[a.status]} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* Warranty list (kept — real and actionable) */}
      {expiringSoon.length > 0 ? (
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <h3 className="text-[15px] font-semibold">Warranties expiring within 30 days</h3>
            <span className="text-xs text-[var(--color-content-subtle)]">
              {expiringSoon.length}
            </span>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {expiringSoon.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/assets/${a.id}`}
                    className="truncate text-[13.5px] font-medium hover:underline"
                  >
                    {a.name}
                  </Link>
                  <p className="text-xs text-[var(--color-content-subtle)]">{a.assetTag}</p>
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-[var(--tone-warning-fg)]">
                  {Math.ceil((new Date(a.warrantyEndDate as string).getTime() - now) / DAY)} days
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
