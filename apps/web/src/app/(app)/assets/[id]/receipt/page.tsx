'use client';

import { use, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/providers/auth-provider';
import { apiFetch } from '@/lib/api-client';
import { ErrorState, Skeleton } from '@/components/ui';

/**
 * Printable handover receipt (v2.15).
 *
 * The paper trail for a device changing hands: what was issued, to whom, in
 * what condition, with what accessories - plus signature lines, because a
 * receipt without a place to sign is a summary. Works for the open assignment;
 * scope rules mean an employee can only ever print their own.
 */

interface ReceiptAsset {
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  condition: string;
  office: { name: string } | null;
  category: { name: string } | null;
  assignedUser: {
    email: string;
    profile: { firstName: string; lastName: string; employeeNumber: string | null } | null;
  } | null;
  assignments: {
    assignedAt: string;
    returnedAt: string | null;
    conditionOut: string;
    acknowledgedAt: string | null;
    expectedReturnAt: string | null;
    accessoriesIssued?: string | null;
    assignedBy: { profile: { firstName: string; lastName: string } | null } | null;
    user: { email: string; profile: { firstName: string; lastName: string } | null } | null;
  }[];
}

const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll('_', ' ');

export default function AssetReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const printed = useRef(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['asset-receipt', id],
    enabled: Boolean(user),
    queryFn: () => apiFetch<ReceiptAsset>(`/assets/${id}`),
  });

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
  if (isError)
    return <ErrorState title="Could not load this asset" detail={(error as Error).message} />;

  const open = data.assignments.find((a) => !a.returnedAt) ?? null;
  const holder =
    open?.user ?? (data.assignedUser as ReceiptAsset['assignments'][number]['user']) ?? null;
  const holderName = holder
    ? holder.profile
      ? `${holder.profile.firstName} ${holder.profile.lastName}`
      : holder.email
    : '—';

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm text-black print:p-0">
      <div className="border-b-2 border-black pb-4">
        <h1 className="text-xl font-bold">Equipment handover receipt</h1>
        <p className="mt-1 text-xs text-neutral-600">
          TechpioAsset · generated {new Date().toLocaleDateString()}
        </p>
      </div>

      {!open ? (
        <p className="mt-4 rounded border border-neutral-400 p-3">
          This asset is not currently issued to anyone. This receipt documents the device only.
        </p>
      ) : null}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Device</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2">
        {(
          [
            ['Asset tag', data.assetTag],
            ['Name', data.name],
            [
              'Make / model',
              [...new Set([data.brand, data.model].filter(Boolean))].join(' ') || '—',
            ],
            ['Serial number', data.serialNumber ?? '—'],
            ['Category', data.category?.name ?? '—'],
            ['Office', data.office?.name ?? '—'],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-neutral-200 py-1">
            <dt className="text-neutral-600">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      {open ? (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide">Handover</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2">
            {(
              [
                ['Issued to', holderName],
                [
                  'Issued by',
                  open.assignedBy?.profile
                    ? `${open.assignedBy.profile.firstName} ${open.assignedBy.profile.lastName}`
                    : '—',
                ],
                ['Issued on', new Date(open.assignedAt).toLocaleDateString()],
                ['Condition at issue', label(open.conditionOut)],
                ['Accessories', open.accessoriesIssued ?? 'None recorded'],
                [
                  'Expected return',
                  open.expectedReturnAt
                    ? new Date(open.expectedReturnAt).toLocaleDateString()
                    : 'Until further notice',
                ],
                [
                  'Receipt confirmed',
                  open.acknowledgedAt
                    ? `Yes — ${new Date(open.acknowledgedAt).toLocaleDateString()} (in app)`
                    : 'Not yet confirmed in app',
                ],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-neutral-200 py-1">
                <dt className="text-neutral-600">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-6 text-sm">
            I confirm that I have received the equipment listed above in the stated condition, and
            that I will return it on request or when I leave the company.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-12">
            <div>
              <div className="border-b border-black pb-8" />
              <p className="mt-1 text-xs text-neutral-600">
                Signature — {holderName} (recipient)
              </p>
            </div>
            <div>
              <div className="border-b border-black pb-8" />
              <p className="mt-1 text-xs text-neutral-600">Signature — issued by, and date</p>
            </div>
          </div>
        </>
      ) : null}

      <p className="mt-10 border-t border-neutral-300 pt-2 text-xs text-neutral-500">
        Generated from piotask.com — {data.assetTag}
        {open ? `, issued ${new Date(open.assignedAt).toLocaleDateString()}` : ''}. In-app receipt
        confirmation is recorded in the audit log independently of this paper copy.
      </p>
    </div>
  );
}
