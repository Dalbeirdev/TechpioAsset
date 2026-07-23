'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { API_BASE, getAccessToken } from '@/lib/api-client';
import { Card } from '@/components/ui';

interface ImportSummary {
  rows: number;
  employeesCreated: number;
  employeesMatched: number;
  assetsCreated: number;
  assetsUpdated: number;
  assigned: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const EXPECTED_COLUMNS = [
  'Asset Id',
  'Asset Name',
  'Asset Category',
  'Asset Type',
  'Purchased On',
  'Warranty expires on',
  'Asset Condition',
  'Asset Status',
  'Assigned To Employee Number',
  'Employee Name, if Assigned',
];

export default function ImportAssetsPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${API_BASE}/assets/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body,
      });
      const json = (await response.json()) as {
        data?: ImportSummary;
        detail?: string;
        title?: string;
      };
      if (!response.ok) throw new Error(json.detail ?? json.title ?? 'Import failed');
      return json.data as ImportSummary;
    },
    onSuccess: (s) => {
      setSummary(s);
      setError(null);
    },
    onError: (e) => {
      setSummary(null);
      setError(e instanceof Error ? e.message : 'Import failed');
    },
  });

  function onPick(file: File | null | undefined) {
    if (!file) return;
    setFileName(file.name);
    setSummary(null);
    setError(null);
    upload.mutate(file);
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Import assets from Excel</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Upload your asset register (.xlsx). Assets are matched by serial number, so re-uploading a
          corrected sheet updates records instead of duplicating them. Employees named in the sheet
          are created automatically and can be invited to sign in later.
        </p>
      </header>

      <Card className="grid gap-4 p-5">
        <label
          className="grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed border-[var(--color-border-strong)] px-6 py-10 text-center transition hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPick(e.dataTransfer.files?.[0]);
          }}
        >
          <FileSpreadsheet aria-hidden="true" className="size-8 text-[var(--color-brand)]" />
          <span className="text-sm font-semibold">
            {fileName ?? 'Drop your .xlsx here, or click to choose'}
          </span>
          <span className="text-xs text-[var(--color-content-subtle)]">Up to 15 MB</span>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
        </label>

        {upload.isPending ? (
          <p className="text-sm text-[var(--color-content-muted)]">
            <Upload aria-hidden="true" className="mr-1.5 inline size-4 animate-pulse" />
            Importing {fileName}…
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
            style={{
              color: 'var(--tone-critical-fg)',
              backgroundColor: 'var(--tone-critical-bg)',
              borderColor: 'var(--tone-critical-border)',
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="rounded-xl bg-[var(--color-surface-sunken)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            Recognised columns
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-content-muted)]">
            {EXPECTED_COLUMNS.join(' · ')}
          </p>
        </div>
      </Card>

      {summary ? (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold">Import complete</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Rows read</dt>
              <dd className="font-semibold tabular-nums">{summary.rows}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Assets created</dt>
              <dd className="font-semibold tabular-nums">{summary.assetsCreated}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Assets updated</dt>
              <dd className="font-semibold tabular-nums">{summary.assetsUpdated}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Employees created</dt>
              <dd className="font-semibold tabular-nums">{summary.employeesCreated}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Assignments</dt>
              <dd className="font-semibold tabular-nums">{summary.assigned}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-content-subtle)]">Skipped</dt>
              <dd className="font-semibold tabular-nums">{summary.skipped}</dd>
            </div>
          </dl>

          {summary.errors.length > 0 ? (
            <div className="mt-4">
              <p className="text-sm font-semibold text-[var(--tone-warning-fg)]">
                {summary.errors.length} row{summary.errors.length === 1 ? '' : 's'} had problems
              </p>
              <ul className="mt-1.5 grid gap-1 text-xs text-[var(--color-content-muted)]">
                {summary.errors.slice(0, 10).map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Link
              href="/assets"
              className="inline-flex h-9 items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-contrast)] hover:bg-[var(--color-brand-hover)]"
            >
              View assets
            </Link>
            <Link
              href="/people"
              className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-4 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              View people
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
