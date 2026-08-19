'use client';

import { use, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/auth-provider';
import { apiFetch } from '@/lib/api-client';
import { ErrorState, Skeleton } from '@/components/ui';

/**
 * Printable request summary (v2.15).
 *
 * The browser's print dialog is the PDF engine: no server dependency, and the
 * document is exactly what the caller is already authorised to see - cost
 * fields the API withheld cannot appear on paper either. The dialog opens
 * automatically once the data is on screen.
 */

interface PrintableRequest {
  requestNumber: string;
  type: string;
  status: string;
  priority: string;
  businessReason: string;
  createdAt: string;
  decidedAt: string | null;
  requiredBy: string | null;
  requester: { email: string; profile: { firstName: string; lastName: string } | null } | null;
  beneficiary: { email: string; profile: { firstName: string; lastName: string } | null } | null;
  office: { name: string } | null;
  department: { name: string } | null;
  estimatedCost?: string | null;
  currency?: string | null;
  items: {
    id: string;
    description: string;
    quantity: number;
    preferredSpec: string | null;
    estimatedCost?: string | null;
    fulfilledAsset: { assetTag: string; name: string } | null;
  }[];
  approvals: {
    id: string;
    stepName: string;
    decision: string;
    reviewStartedAt: string | null;
    decidedAt: string | null;
    comment: string | null;
    approver: { profile: { firstName: string; lastName: string } | null } | null;
  }[];
  workOrder?: { title: string; status: string } | null;
}

const personName = (
  p: { email: string; profile: { firstName: string; lastName: string } | null } | null,
) => (p ? (p.profile ? `${p.profile.firstName} ${p.profile.lastName}` : p.email) : '—');

const label = (v: string) =>
  v.charAt(0) + v.slice(1).toLowerCase().replaceAll('_', ' ');

export default function RequestPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const printed = useRef(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['request-print', id],
    enabled: Boolean(user),
    queryFn: () => apiFetch<PrintableRequest>(`/requests/${id}`),
  });

  // One automatic dialog, once the content exists. Reprinting is Ctrl+P.
  useEffect(() => {
    // ?noprint=1 renders the document without summoning the dialog - for
    // checking the layout, and for automated verification.
    if (new URLSearchParams(window.location.search).has('noprint')) return;
    if (data && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 300);
    }
  }, [data]);

  if (isPending) return <Skeleton className="h-64" />;
  if (isError) return <ErrorState title="Could not load this request" detail={(error as Error).message} />;

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-black print:p-0">
      <div className="flex items-start justify-between border-b-2 border-black pb-4">
        <div>
          <h1 className="text-xl font-bold">Equipment request {data.requestNumber}</h1>
          <p className="mt-1 text-xs text-neutral-600">
            PioAssets · generated {new Date().toLocaleDateString()}
          </p>
        </div>
        <span className="rounded border border-black px-2 py-1 text-xs font-semibold uppercase">
          {label(data.status)}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2">
        {(
          [
            ['Type', label(data.type)],
            ['Priority', label(data.priority)],
            ['Raised by', personName(data.requester)],
            ['For', personName(data.beneficiary ?? data.requester)],
            ['Office', data.office?.name ?? '—'],
            ['Department', data.department?.name ?? '—'],
            ['Raised on', new Date(data.createdAt).toLocaleDateString()],
            [
              'Needed by',
              data.requiredBy ? new Date(data.requiredBy).toLocaleDateString() : '—',
            ],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-neutral-200 py-1">
            <dt className="text-neutral-600">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Business reason</h2>
      <p className="mt-1 whitespace-pre-wrap">{data.businessReason}</p>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Items</h2>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-1 pr-2">Description</th>
            <th className="py-1 pr-2">Qty</th>
            {/* The API omits estimatedCost for callers without cost read; a
                column of blanks would imply redaction, so it only renders
                when at least one item carries a figure. */}
            {data.items.some((i) => Number(i.estimatedCost) > 0) ? (
              <th className="py-1 pr-2 text-right">Est. cost</th>
            ) : null}
            <th className="py-1">Fulfilled with</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id} className="border-b border-neutral-200 align-top">
              <td className="py-1.5 pr-2">
                {item.description}
                {item.preferredSpec ? (
                  <span className="block text-xs text-neutral-600">{item.preferredSpec}</span>
                ) : null}
              </td>
              <td className="py-1.5 pr-2">{item.quantity}</td>
              {data.items.some((i) => Number(i.estimatedCost) > 0) ? (
                <td className="py-1.5 pr-2 text-right">
                  {Number(item.estimatedCost) > 0 ? `${data.currency ?? ''} ${item.estimatedCost}` : '—'}
                </td>
              ) : null}
              <td className="py-1.5">
                {item.fulfilledAsset
                  ? `${item.fulfilledAsset.assetTag} — ${item.fulfilledAsset.name}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.approvals.length > 0 ? (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Approval trail</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="py-1 pr-2">Step</th>
                <th className="py-1 pr-2">Decision</th>
                <th className="py-1 pr-2">By</th>
                <th className="py-1 pr-2">On</th>
                {/* The reviewer's note is half the point of the trail - an
                    approval without its reasoning prints as a rubber stamp. */}
                <th className="py-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.approvals.map((a) => (
                <tr key={a.id} className="border-b border-neutral-200">
                  <td className="py-1.5 pr-2">{a.stepName}</td>
                  <td className="py-1.5 pr-2">
                    {a.decision === 'PENDING' && a.reviewStartedAt
                      ? 'Under review'
                      : label(a.decision)}
                  </td>
                  <td className="py-1.5 pr-2">{personName(a.approver as never)}</td>
                  <td className="py-1.5 pr-2">
                    {a.decidedAt ? new Date(a.decidedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-1.5">{a.comment ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {data.workOrder ? (
        <p className="mt-4 text-sm">
          <span className="font-semibold">Work order:</span> {data.workOrder.title} (
          {label(data.workOrder.status)})
        </p>
      ) : null}

      <p className="mt-8 border-t border-neutral-300 pt-2 text-xs text-neutral-500">
        Generated from pioassets.com — request {data.requestNumber}. Figures reflect what the
        generating user is authorised to see.
      </p>
    </div>
  );
}
