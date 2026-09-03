'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { PR_STATUS_TONE, TonePill, fmtDate, inputCls } from '@/components/procurement/shared';
import { RfqPanel } from '@/components/procurement/rfq-panel';

interface PrDetail {
  id: string;
  prNumber: string;
  status: string;
  justification: string;
  estimatedTotal: string | null;
  neededBy: string | null;
  rejectedReason: string | null;
  convertedPoId: string | null;
  createdAt: string;
  // v2.9 C2 - what it is charged to, and what it is holding.
  costCentre: { id: string; code: string; name: string } | null;
  committedAmount: string | null;
  committedAt: string | null;
  requester: { id: string; email: string; profile: { firstName: string; lastName: string } | null };
  lines: { id: string; lineNumber: number; description: string; quantity: string; estimatedUnitPrice: string | null }[];
}

export default function PurchaseRequestPage() {
  const { id } = useParams<{ id: string }>();
  const { user, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const { data: pr, isPending, isError, error } = useQuery({
    queryKey: ['purchase-request', id],
    queryFn: () => apiFetch<PrDetail>(`/procurement/requests/${id}`),
  });
  const vendors = useQuery({
    queryKey: ['vendors-for-pr'],
    queryFn: () => apiFetchPage<{ id: string; name: string }>('/vendors?pageSize=100'),
    enabled: can(PERMISSIONS.PROCUREMENT_PR_CONVERT),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['purchase-request', id] });
  const act = (path: string, body?: object) =>
    apiFetch(`/procurement/requests/${id}/${path}`, { method: 'POST', ...(body ? { body } : {}) });

  const submit = useMutation({
    mutationFn: () => act('submit'),
    onSuccess: () => { toast.success('Submitted for approval'); void refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not submit'),
  });
  const decide = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT') =>
      act('decision', { decision, ...(decision === 'REJECT' && rejectReason ? { reason: rejectReason } : {}) }),
    onSuccess: () => { toast.success('Decision recorded'); void refresh(); },
    // SoD and the Finance threshold speak here, verbatim.
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not decide'),
  });
  const convert = useMutation({
    mutationFn: () =>
      apiFetch<{ purchaseOrderId: string }>(`/procurement/requests/${id}/convert`, {
        method: 'POST',
        // v2.9 C3: when a quote has been awarded the API takes the vendor and
        // the prices from it, and refuses a different vendor outright.
        body: vendorId ? { vendorId } : {},
      }),
    onSuccess: (r) => { toast.success('Purchase order drafted'); window.location.href = `/procurement/orders/${r.purchaseOrderId}`; },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not convert'),
  });

  if (isPending) return <Skeleton className="h-96" />;
  if (isError) return <ErrorState title="Could not load the request" detail={(error as Error).message} />;

  const isRequester = user?.id === pr.requester.id;
  const canDecide = can(PERMISSIONS.PROCUREMENT_PR_APPROVE) && pr.status === 'SUBMITTED';

  return (
    <div className="grid gap-5">
      <header>
        <Link href="/procurement" className="text-xs font-semibold text-[var(--color-brand)]">
          ← Procurement
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
          <ShoppingCart className="size-6 text-[var(--color-brand)]" /> {pr.prNumber}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--color-content-muted)]">
          <TonePill label={pr.status} tone={PR_STATUS_TONE[pr.status] ?? 'neutral'} />
          <span>
            by {pr.requester.profile ? `${pr.requester.profile.firstName} ${pr.requester.profile.lastName}` : pr.requester.email}
          </span>
          <span>· {fmtDate(pr.createdAt)}</span>
          {pr.estimatedTotal ? (
            <span className="font-semibold tabular-nums">· est. {Number(pr.estimatedTotal).toLocaleString()}</span>
          ) : null}
        </div>
      </header>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">Justification</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-content-muted)]">{pr.justification}</p>
        {pr.rejectedReason ? (
          <p className="mt-2 rounded-lg p-2.5 text-xs" style={{ background: 'var(--tone-critical-bg)', color: 'var(--tone-critical-fg)' }}>
            Rejected: {pr.rejectedReason}
          </p>
        ) : null}
      </Card>

      {pr.costCentre ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
              Charged to
            </p>
            <p className="mt-0.5 text-sm font-medium">
              {pr.costCentre.code} — {pr.costCentre.name}
            </p>
          </div>
          <div className="text-right">
            {pr.committedAmount ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Holding against the budget
                </p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {Number(pr.committedAmount).toLocaleString()}
                  <span className="font-normal text-[var(--color-content-muted)]">
                    {' '}
                    since {fmtDate(pr.committedAt)}
                  </span>
                </p>
              </>
            ) : (
              <p className="text-xs text-[var(--color-content-muted)]">
                {pr.status === 'CANCELLED'
                  ? 'Cancelled — the budget was released.'
                  : 'Nothing held yet; approval commits the estimate.'}
              </p>
            )}
          </div>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
              <th className="px-4 py-3 font-semibold">#</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="px-4 py-3 font-semibold">Qty</th>
              <th className="px-4 py-3 font-semibold">Unit price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {pr.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3 tabular-nums">{l.lineNumber}</td>
                <td className="px-4 py-3">{l.description}</td>
                <td className="px-4 py-3 tabular-nums">{Number(l.quantity)}</td>
                <td className="px-4 py-3 tabular-nums">
                  {l.estimatedUnitPrice ? Number(l.estimatedUnitPrice).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Actions by state and role */}
      <Card className="flex flex-wrap items-center gap-3 p-4">
        {/* A draft and a rejected request offer the same action - the requester
            sends it (again) - but they are not the same situation, so they do
            not get the same words. A rejected request has already been seen and
            turned down; telling a reader it is "waiting to be submitted" reads
            as though nothing has happened yet. */}
        {pr.status === 'DRAFT' || pr.status === 'REJECTED' ? (
          isRequester ? (
            <Button loading={submit.isPending} onClick={() => submit.mutate()}>
              {pr.status === 'REJECTED' ? 'Revise and send again' : 'Submit for approval'}
            </Button>
          ) : (
            <p className="text-sm text-[var(--color-content-subtle)]">
              {pr.status === 'REJECTED'
                ? 'Rejected. The requester can revise it and send it again.'
                : 'Waiting for the requester to submit.'}
            </p>
          )
        ) : null}

        {canDecide ? (
          <>
            <Button loading={decide.isPending} onClick={() => decide.mutate('APPROVE')}>
              Approve
            </Button>
            <input
              aria-label="Rejection reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (for rejection)"
              className={`${inputCls} max-w-xs`}
            />
            <Button variant="danger" loading={decide.isPending} onClick={() => decide.mutate('REJECT')}>
              Reject
            </Button>
            {isRequester ? (
              <p className="text-xs text-[var(--color-content-subtle)]">
                You raised this request — separation of duties means someone else must decide it.
              </p>
            ) : null}
          </>
        ) : null}

        {pr.status === 'APPROVED' && can(PERMISSIONS.PROCUREMENT_PR_CONVERT) ? (
          <>
            <select
              aria-label="Vendor"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className={`${inputCls} max-w-xs`}
            >
              <option value="">Vendor (or leave blank if a quote was awarded)</option>
              {(vendors.data?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <Button loading={convert.isPending} onClick={() => convert.mutate()}>
              Convert to purchase order
            </Button>
          </>
        ) : null}

        {pr.status === 'CONVERTED' && pr.convertedPoId ? (
          <Link href={`/procurement/orders/${pr.convertedPoId}`} className="text-sm font-semibold text-[var(--color-brand)]">
            View the purchase order →
          </Link>
        ) : null}
      </Card>

      <RfqPanel purchaseRequestId={pr.id} prStatus={pr.status} lines={pr.lines} />
    </div>
  );
}
