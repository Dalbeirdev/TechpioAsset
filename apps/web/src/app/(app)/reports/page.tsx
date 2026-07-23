'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { apiFetch, API_BASE, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { PERMISSIONS } from '@techpioasset/domain';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';

interface ReportTable {
  title: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
}

const REPORTS = [
  { type: 'ASSET_INVENTORY', label: 'Asset inventory', financial: false },
  { type: 'WARRANTY_EXPIRY', label: 'Warranty expiry', financial: false },
  { type: 'SPENDING_BY_VENDOR', label: 'Spending by vendor', financial: true },
  { type: 'SPENDING_BY_CATEGORY', label: 'Spending by category', financial: true },
  { type: 'SPENDING_BY_DEPARTMENT', label: 'Spending by department', financial: true },
  { type: 'DEPRECIATION', label: 'Depreciation', financial: true },
  { type: 'MAINTENANCE_COST', label: 'Maintenance cost', financial: true },
] as const;

const PAGE_SIZE = 25;

export default function ReportsPage() {
  const { can } = useAuth();
  const [type, setType] = useState<(typeof REPORTS)[number]['type']>('ASSET_INVENTORY');
  const [page, setPage] = useState(1);
  const canSeeCost = can(PERMISSIONS.ASSETS_COST_READ);
  const canExport = can(PERMISSIONS.REPORTS_EXPORT);

  // Only offer reports the caller can actually run.
  const available = REPORTS.filter((r) => !r.financial || canSeeCost);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['report', type],
    queryFn: () => apiFetch<ReportTable>(`/reports?type=${type}`),
  });

  function download(format: 'CSV' | 'XLSX') {
    // A signed fetch to a blob, then a synthetic download — keeps the Authorization
    // header, which a bare anchor href could not carry.
    void (async () => {
      const response = await fetch(`${API_BASE}/reports?type=${type}&format=${format}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${type.toLowerCase()}.${format === 'CSV' ? 'csv' : 'xls'}`;
      anchor.click();
      URL.revokeObjectURL(url);
    })();
  }

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {canSeeCost ? 'Inventory and financial reports.' : 'Inventory reports.'}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-content-muted)]">Report</span>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setPage(1);
              }}
              className="h-10 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {available.map((r) => (
                <option key={r.type} value={r.type}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {canExport ? (
            <>
              <Button variant="secondary" onClick={() => download('CSV')}>
                <Download aria-hidden="true" className="size-4" />
                CSV
              </Button>
              <Button variant="secondary" onClick={() => download('XLSX')}>
                <Download aria-hidden="true" className="size-4" />
                Excel
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load the report" detail={(error as Error).message} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{data.title}</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  {data.columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className={`px-4 py-2.5 font-medium ${col.numeric ? 'text-right' : ''}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row, index) => (
                  <tr key={index} className="hover:bg-[var(--color-surface-sunken)]">
                    {data.columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-2 ${col.numeric ? 'text-right tabular-nums' : ''}`}
                      >
                        {col.numeric && typeof row[col.key] === 'number'
                          ? Number(row[col.key]).toLocaleString()
                          : (row[col.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-[var(--color-content-subtle)]">
                No data for this report.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {data && data.rows.length > PAGE_SIZE ? (
        <nav aria-label="Report pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {page} of {Math.ceil(data.rows.length / PAGE_SIZE)} · {data.rows.length} rows
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= Math.ceil(data.rows.length / PAGE_SIZE)}
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
