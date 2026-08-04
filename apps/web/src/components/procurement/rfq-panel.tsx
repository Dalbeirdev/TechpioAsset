'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Send } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card } from '@/components/ui';
import { TonePill, fmtDate, inputCls } from '@/components/procurement/shared';

/**
 * v2.9 C3 — the competition, next to the purchase it justifies.
 *
 * The comparison is the point: it names the cheapest and the fastest, and when
 * those are different vendors it says so, because that is exactly the moment
 * the award reason has to do some work.
 */

interface QuoteLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}
interface Quote {
  id: string;
  status: string;
  currency: string | null;
  total: string | null;
  leadTimeDays: number | null;
  reference: string | null;
  receivedAt: string | null;
  convertedPoId: string | null;
  vendor: { id: string; name: string };
  lines: QuoteLine[];
}
interface Comparison {
  rows: {
    id: string;
    rank: number | null;
    isCheapest: boolean;
    isFastest: boolean;
    premiumOverCheapest: string | null;
  }[];
  responded: number;
  awaiting: number;
  cheapestQuoteId: string | null;
  fastestQuoteId: string | null;
  cheapestIsNotFastest: boolean;
}
interface Rfq {
  id: string;
  rfqNumber: string;
  status: string;
  dueDate: string | null;
  awardedQuoteId: string | null;
  awardReason: string | null;
  awardedAt: string | null;
  quotes: Quote[];
  comparison: Comparison;
}

const QUOTE_TONE: Record<string, string> = {
  INVITED: 'neutral',
  RECEIVED: 'progress',
  AWARDED: 'success',
  LOST: 'neutral',
  DECLINED: 'warning',
};

export function RfqPanel({
  purchaseRequestId,
  prStatus,
  lines,
}: {
  purchaseRequestId: string;
  prStatus: string;
  lines: { id: string; description: string; quantity: string }[];
}) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = can(PERMISSIONS.PROCUREMENT_RFQ_MANAGE);

  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [unitPrices, setUnitPrices] = useState<Record<string, string>>({});
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [awardingId, setAwardingId] = useState<string | null>(null);
  const [awardReason, setAwardReason] = useState('');

  const rfqs = useQuery({
    queryKey: ['rfqs', purchaseRequestId],
    queryFn: () =>
      apiFetch<{ id: string }[]>(`/procurement/rfqs?purchaseRequestId=${purchaseRequestId}`),
  });
  const activeId = rfqs.data?.[0]?.id ?? null;
  const rfq = useQuery({
    queryKey: ['rfq', activeId],
    enabled: Boolean(activeId),
    queryFn: () => apiFetch<Rfq>(`/procurement/rfqs/${activeId}`),
  });
  const vendors = useQuery({
    queryKey: ['vendors-for-rfq'],
    enabled: canManage && prStatus === 'APPROVED' && !activeId,
    queryFn: () => apiFetchPage<{ id: string; name: string }>('/vendors?pageSize=100'),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['rfqs', purchaseRequestId] });
    void qc.invalidateQueries({ queryKey: ['rfq', activeId] });
    void qc.invalidateQueries({ queryKey: ['purchase-request', purchaseRequestId] });
  };

  const raise = useMutation({
    mutationFn: () =>
      apiFetch(`/procurement/requests/${purchaseRequestId}/rfq`, { method: 'POST', body: { vendorIds } }),
    onSuccess: () => { toast.success('Quotes requested'); setVendorIds([]); refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not request quotes'),
  });

  const record = useMutation({
    mutationFn: (quoteId: string) =>
      apiFetch(`/procurement/quotes/${quoteId}/response`, {
        method: 'POST',
        body: {
          currency: 'USD',
          ...(leadTimeDays ? { leadTimeDays: Number(leadTimeDays) } : {}),
          lines: lines.map((l) => ({
            purchaseRequestLineId: l.id,
            description: l.description,
            quantity: Number(l.quantity),
            unitPrice: unitPrices[l.id] ?? '0',
          })),
        },
      }),
    onSuccess: () => {
      toast.success('Quote recorded');
      setRespondingTo(null);
      setUnitPrices({});
      setLeadTimeDays('');
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not record the quote'),
  });

  const award = useMutation({
    mutationFn: (quoteId: string) =>
      apiFetch(`/procurement/rfqs/${activeId}/award`, {
        method: 'POST',
        body: { quoteId, reason: awardReason.trim() },
      }),
    onSuccess: () => {
      toast.success('Awarded — the order can now be raised from this quote');
      setAwardingId(null);
      setAwardReason('');
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not award'),
  });

  // Nothing to show and nothing to start: stay out of the way entirely.
  if (!activeId && (!canManage || prStatus !== 'APPROVED')) return null;

  if (!activeId) {
    return (
      <Card className="p-4">
        <h2 className="text-sm font-semibold">Ask vendors to quote</h2>
        <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
          Pick at least two — one quote is not a comparison.
        </p>
        <div className="mt-3 grid gap-1.5">
          {(vendors.data?.data ?? []).map((v) => (
            <label key={v.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={vendorIds.includes(v.id)}
                onChange={(e) =>
                  setVendorIds((prev) => (e.target.checked ? [...prev, v.id] : prev.filter((x) => x !== v.id)))
                }
              />
              {v.name}
            </label>
          ))}
        </div>
        <Button
          className="mt-3"
          loading={raise.isPending}
          disabled={vendorIds.length < 2}
          onClick={() => raise.mutate()}
        >
          <Send className="size-4" /> Request quotes
        </Button>
      </Card>
    );
  }

  if (!rfq.data) return null;
  const r = rfq.data;
  const rowFor = (quoteId: string) => r.comparison.rows.find((x) => x.id === quoteId);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gavel className="size-4 text-[var(--color-brand)]" /> {r.rfqNumber}
        </h2>
        <TonePill label={r.status} tone={r.status === 'AWARDED' ? 'success' : 'progress'} />
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
        {r.comparison.responded} of {r.comparison.responded + r.comparison.awaiting} vendor(s) have answered
        {r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : ''}
      </p>

      {r.comparison.cheapestIsNotFastest && !r.awardedQuoteId ? (
        <p
          className="mt-2 rounded-lg p-2.5 text-xs"
          style={{ background: 'var(--tone-warning-bg)', color: 'var(--tone-warning-fg)' }}
        >
          The cheapest quote is not the fastest. Whichever you award, the reason is what explains the
          trade-off later.
        </p>
      ) : null}

      <div className="mt-3 grid gap-2">
        {r.quotes.map((q) => {
          const row = rowFor(q.id);
          return (
            <div
              key={q.id}
              className="rounded-[var(--radius-control)] border border-[var(--color-border)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{q.vendor.name}</span>
                  <TonePill label={q.status} tone={QUOTE_TONE[q.status] ?? 'neutral'} />
                  {row?.isCheapest ? <TonePill label="cheapest" tone="success" /> : null}
                  {row?.isFastest ? <TonePill label="fastest" tone="info" /> : null}
                </div>
                <div className="text-sm tabular-nums">
                  {q.total ? (
                    <>
                      <span className="font-semibold">
                        {Number(q.total).toLocaleString()} {q.currency}
                      </span>
                      {q.leadTimeDays !== null ? (
                        <span className="text-[var(--color-content-muted)]"> · {q.leadTimeDays} days</span>
                      ) : null}
                      {row?.premiumOverCheapest && Number(row.premiumOverCheapest) > 0 ? (
                        <span className="text-[var(--color-content-subtle)]">
                          {' '}
                          · +{Number(row.premiumOverCheapest).toLocaleString()}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[var(--color-content-subtle)]">no response yet</span>
                  )}
                </div>
              </div>

              {canManage && r.status === 'SENT' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.status !== 'AWARDED' && q.status !== 'LOST' ? (
                    <Button variant="secondary" onClick={() => setRespondingTo(respondingTo === q.id ? null : q.id)}>
                      {q.status === 'RECEIVED' ? 'Update quote' : 'Record quote'}
                    </Button>
                  ) : null}
                  {q.status === 'RECEIVED' ? (
                    <Button variant="secondary" onClick={() => setAwardingId(awardingId === q.id ? null : q.id)}>
                      <Gavel className="size-4" /> Award this
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {respondingTo === q.id ? (
                <div className="mt-3 grid gap-2">
                  {lines.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-40 text-[13px]">{l.description} × {Number(l.quantity)}</span>
                      <input
                        aria-label={`Unit price from ${q.vendor.name} for ${l.description}`}
                        inputMode="decimal"
                        value={unitPrices[l.id] ?? ''}
                        onChange={(e) => setUnitPrices((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        placeholder="Unit price"
                        className={`${inputCls} w-32`}
                      />
                    </div>
                  ))}
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label htmlFor={`lead-${q.id}`} className="mb-1 block text-[13px] font-medium">
                        Lead time (days)
                      </label>
                      <input
                        id={`lead-${q.id}`}
                        inputMode="numeric"
                        value={leadTimeDays}
                        onChange={(e) => setLeadTimeDays(e.target.value)}
                        className={`${inputCls} w-28`}
                      />
                    </div>
                    <Button loading={record.isPending} onClick={() => record.mutate(q.id)}>
                      Save quote
                    </Button>
                  </div>
                </div>
              ) : null}

              {awardingId === q.id ? (
                <div className="mt-3 grid gap-2">
                  <label htmlFor={`why-${q.id}`} className="text-[13px] font-medium">
                    Why this quote? (at least 10 characters — it goes on the record)
                  </label>
                  <textarea
                    id={`why-${q.id}`}
                    value={awardReason}
                    onChange={(e) => setAwardReason(e.target.value)}
                    rows={2}
                    className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] p-2 text-sm"
                  />
                  <div>
                    <Button
                      loading={award.isPending}
                      disabled={awardReason.trim().length < 10}
                      onClick={() => award.mutate(q.id)}
                    >
                      Award to {q.vendor.name}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {r.awardReason ? (
        <p className="mt-3 rounded-lg p-2.5 text-xs" style={{ background: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' }}>
          Awarded {fmtDate(r.awardedAt)}: {r.awardReason}
        </p>
      ) : null}
    </Card>
  );
}
