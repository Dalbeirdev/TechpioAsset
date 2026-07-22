'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, ShieldCheck, Sparkles } from 'lucide-react';
import { VERIFICATION_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { PERMISSIONS, type VerificationStatus } from '@techpioasset/domain';
import { apiFetch, ApiError, API_BASE, getAccessToken } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';

interface Issue {
  code: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  lineNumber?: number;
  expected?: string;
  actual?: string;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  currency: string;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  verificationStatus: VerificationStatus;
  reviewNotes: string | null;
  vendor: { id: string; name: string } | null;
  lines: {
    id: string;
    lineNumber: number;
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal: string;
    assetLinks: { asset: { id: string; assetTag: string; name: string } | null }[];
  }[];
  documents: { id: string; originalName: string; mimeType: string }[];
  extractions: {
    id: string;
    provider: string;
    overallConfidence: string | null;
    simulated: boolean;
    fieldConfidences: Record<string, number> | null;
  }[];
  verifications: {
    id: string;
    issues: Issue[];
    outcome: VerificationStatus;
    decidedAt: string | null;
    notes: string | null;
    decidedBy: { email: string; profile: { firstName: string; lastName: string } | null } | null;
  }[];
}

const SEVERITY_TONE = { ERROR: 'critical', WARNING: 'warning', INFO: 'info' } as const;

export default function InvoiceReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [docUrl, setDocUrl] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => apiFetch<InvoiceDetail>(`/invoices/${id}`),
  });

  const decide = useMutation({
    mutationFn: (decision: 'VERIFIED' | 'REJECTED') =>
      apiFetch(`/invoices/${id}/decision`, {
        method: 'POST',
        body: { decision, ...(notes ? { notes } : {}) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });

  if (isPending) return <Skeleton className="h-96" />;
  if (isError)
    return <ErrorState title="Could not load this invoice" detail={(error as Error).message} />;

  const extraction = data.extractions[0];
  const verification = data.verifications[0];
  const issues = verification?.issues ?? [];
  const threshold = 0.85;
  const canVerify = can(PERMISSIONS.INVOICES_VERIFY) && !verification?.decidedAt;
  const document = data.documents[0];

  const confidenceOf = (field: string): number | null =>
    extraction?.fieldConfidences?.[field] ?? null;

  function loadDocument() {
    if (!document) return;
    // The signed URL is minted server-side; here we fetch it as a blob so the
    // Authorization header is applied, then show it in the object frame.
    void (async () => {
      const response = await fetch(`${API_BASE}/storage/preview/${document.id}`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      }).catch(() => null);
      if (response?.ok) setDocUrl(URL.createObjectURL(await response.blob()));
    })();
  }

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{data.invoiceNumber}</h1>
            <StatusBadge token={VERIFICATION_STATUS_TOKENS[data.verificationStatus]} size="sm" />
          </div>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            {data.vendor?.name ?? 'Unknown vendor'} ·{' '}
            {new Date(data.invoiceDate).toLocaleDateString()}
          </p>
        </div>
        {extraction?.simulated ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
            style={{
              color: 'var(--tone-warning-fg)',
              backgroundColor: 'var(--tone-warning-bg)',
              borderColor: 'var(--tone-warning-border)',
            }}
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            AI extraction simulated — not a real OCR result
          </span>
        ) : null}
      </header>

      {/* Split screen: document on the left, extracted data and verification on the right. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex min-h-[32rem] flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Document</h2>
            {document ? (
              <span className="text-xs text-[var(--color-content-subtle)]">
                {document.originalName}
              </span>
            ) : null}
          </div>
          {!document ? (
            <div className="grid flex-1 place-items-center text-sm text-[var(--color-content-subtle)]">
              No document — this invoice was entered manually.
            </div>
          ) : docUrl ? (
            <object
              data={docUrl}
              type={document.mimeType}
              className="flex-1 rounded border border-[var(--color-border)]"
            >
              <p className="p-4 text-sm">Preview unavailable in this browser.</p>
            </object>
          ) : (
            <button
              type="button"
              onClick={loadDocument}
              className="grid flex-1 place-items-center gap-2 rounded border border-dashed border-[var(--color-border-strong)] text-sm hover:bg-[var(--color-surface-sunken)]"
            >
              <FileText aria-hidden="true" className="size-8 text-[var(--color-content-subtle)]" />
              Load document preview
            </button>
          )}
        </Card>

        <div className="grid gap-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Extracted fields</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  {
                    label: 'Subtotal',
                    value: `${data.currency} ${Number(data.subtotal).toLocaleString()}`,
                    field: 'subtotal',
                  },
                  {
                    label: 'Tax',
                    value: `${data.currency} ${Number(data.tax).toLocaleString()}`,
                    field: 'tax',
                  },
                  {
                    label: 'Total',
                    value: `${data.currency} ${Number(data.total).toLocaleString()}`,
                    field: 'total',
                  },
                ] as const
              ).map(({ label, value, field }) => {
                const confidence = confidenceOf(field);
                const low = confidence !== null && confidence < threshold;
                return (
                  <div key={label}>
                    <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
                    <dd className="flex items-center gap-1.5 font-medium tabular-nums">
                      {value}
                      {low ? (
                        // Low-confidence values are highlighted for the reviewer.
                        <span
                          title={`Confidence ${(confidence * 100).toFixed(0)}%`}
                          className="inline-flex items-center gap-0.5 rounded px-1 text-[10px]"
                          style={{
                            color: 'var(--tone-warning-fg)',
                            backgroundColor: 'var(--tone-warning-bg)',
                          }}
                        >
                          <AlertTriangle aria-hidden="true" className="size-2.5" />
                          {(confidence * 100).toFixed(0)}%
                        </span>
                      ) : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">Line items</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-content-subtle)]">
                    <th scope="col" className="py-1.5 pr-2 font-medium">
                      Description
                    </th>
                    <th scope="col" className="py-1.5 px-2 text-right font-medium">
                      Qty
                    </th>
                    <th scope="col" className="py-1.5 px-2 text-right font-medium">
                      Unit
                    </th>
                    <th scope="col" className="py-1.5 pl-2 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {data.lines.map((line) => {
                    const lineIssue = issues.find(
                      (i) => i.lineNumber === line.lineNumber && i.severity === 'ERROR',
                    );
                    return (
                      <tr
                        key={line.id}
                        style={
                          lineIssue ? { backgroundColor: 'var(--tone-critical-bg)' } : undefined
                        }
                      >
                        <td className="py-1.5 pr-2">
                          {line.description}
                          {line.assetLinks[0]?.asset ? (
                            <span className="ml-1 text-xs text-[var(--color-content-subtle)]">
                              → {line.assetLinks[0].asset.assetTag}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {Number(line.quantity)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {Number(line.unitPrice).toLocaleString()}
                        </td>
                        <td className="py-1.5 pl-2 text-right tabular-nums">
                          {Number(line.lineTotal).toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold">
              Verification issues
              {issues.length > 0 ? (
                <span className="ml-2 text-xs text-[var(--color-content-subtle)]">
                  {issues.length}
                </span>
              ) : null}
            </h2>
            {issues.length === 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--tone-success-fg)]">
                <ShieldCheck aria-hidden="true" className="size-4" />
                No issues found by the deterministic checks.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {issues.map((issue, index) => {
                  const tone = SEVERITY_TONE[issue.severity];
                  return (
                    <li
                      key={index}
                      className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                      style={{
                        color: `var(--tone-${tone}-fg)`,
                        backgroundColor: `var(--tone-${tone}-bg)`,
                        borderColor: `var(--tone-${tone}-border)`,
                      }}
                    >
                      {issue.message}
                      {issue.expected ? (
                        <span className="mt-0.5 block text-xs opacity-80">
                          Expected {issue.expected}, got {issue.actual}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {verification?.decidedAt ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Decision</h2>
              <p className="mt-2 text-sm">
                <StatusBadge
                  token={VERIFICATION_STATUS_TOKENS[data.verificationStatus]}
                  size="sm"
                />{' '}
                by{' '}
                {verification.decidedBy?.profile
                  ? `${verification.decidedBy.profile.firstName} ${verification.decidedBy.profile.lastName}`
                  : verification.decidedBy?.email}
              </p>
              {verification.notes ? (
                <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                  “{verification.notes}”
                </p>
              ) : null}
            </Card>
          ) : canVerify ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Your decision</h2>
              <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                A human decision is required — AI never verifies an invoice on its own.
              </p>
              <textarea
                aria-label="Review notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="mt-3 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2.5 text-sm"
              />
              {decide.isError ? (
                <p
                  role="alert"
                  className="mt-2 text-xs"
                  style={{ color: 'var(--tone-critical-fg)' }}
                >
                  {decide.error instanceof ApiError
                    ? decide.error.problem?.detail
                    : 'Could not record the decision.'}
                </p>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  loading={decide.isPending}
                  onClick={() => decide.mutate('REJECTED')}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  loading={decide.isPending}
                  onClick={() => decide.mutate('VERIFIED')}
                >
                  Verify
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
