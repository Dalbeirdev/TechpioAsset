'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackageCheck, Send } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { ApiError, apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { PO_STATUS_TONE, TonePill, fmtDate, inputCls } from '@/components/procurement/shared';

interface PoLine {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string;
  unitPrice: string;
  receivedQuantity: string;
}
interface PoDetail {
  id: string;
  poNumber: string;
  status: string;
  issuedDate: string | null;
  currency: string;
  total: string;
  vendor: { name: string } | null;
  lines: PoLine[];
  receipts: { id: string; grnNumber: string; receivedAt: string; notes: string | null; lines: { quantity: string }[] }[];
}
interface StockRefs {
  locations: { id: string; name: string }[];
  items: { id: string; name: string }[];
}

export default function PurchaseOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  // Per-line receive quantities + intake destination for STOCK lines.
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [intake, setIntake] = useState<'STOCK' | 'ASSET'>('ASSET');
  const [locationId, setLocationId] = useState('');
  const [itemId, setItemId] = useState('');
  const [overReceipt, setOverReceipt] = useState<string | null>(null);

  const { data: po, isPending, isError, error } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => apiFetch<PoDetail>(`/procurement/orders/${id}`),
  });

  const canReceive = can(PERMISSIONS.PROCUREMENT_RECEIVE);
  const refs = useQuery({
    queryKey: ['stock-refs'],
    enabled: canReceive,
    queryFn: async (): Promise<StockRefs> => {
      const [locations, items] = await Promise.all([
        apiFetch<{ id: string; name: string }[]>('/stock/locations'),
        apiFetch<{ id: string; name: string }[]>('/stock/items').catch(
          () => [] as { id: string; name: string }[],
        ),
      ]);
      return { locations, items };
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['purchase-order', id] });

  const issue = useMutation({
    mutationFn: () => apiFetch(`/procurement/orders/${id}/issue`, { method: 'POST' }),
    onSuccess: () => { toast.success('Order issued to the vendor'); void refresh(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not issue'),
  });

  const receive = useMutation({
    mutationFn: () => {
      const lines = Object.entries(receiveQty)
        .filter(([, q]) => q > 0)
        .map(([purchaseOrderLineId, quantity]) => ({
          purchaseOrderLineId,
          quantity,
          intake,
          ...(intake === 'STOCK' ? { stockLocationId: locationId, inventoryItemId: itemId } : {}),
        }));
      return apiFetch(`/procurement/orders/${id}/receive`, { method: 'POST', body: { lines } });
    },
    onSuccess: () => {
      toast.success('Goods received');
      setReceiveQty({});
      setOverReceipt(null);
      void refresh();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setOverReceipt(e.message);
      else toast.error(e instanceof Error ? e.message : 'Could not receive');
    },
  });

  if (isPending) return <Skeleton className="h-96" />;
  if (isError) return <ErrorState title="Could not load the order" detail={(error as Error).message} />;

  const receivable = po.status === 'ISSUED' || po.status === 'PARTIALLY_RECEIVED';
  const anyQty = Object.values(receiveQty).some((q) => q > 0);
  const stockRefsOk = intake === 'ASSET' || (locationId && itemId);

  return (
    <div className="grid gap-5">
      <header>
        <Link href="/procurement" className="text-xs font-semibold text-[var(--color-brand)]">
          ← Procurement
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
          <PackageCheck className="size-6 text-[var(--color-brand)]" /> {po.poNumber}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--color-content-muted)]">
          <TonePill label={po.status} tone={PO_STATUS_TONE[po.status] ?? 'neutral'} />
          <span>{po.vendor?.name}</span>
          <span>· {Number(po.total).toLocaleString()} {po.currency}</span>
          {po.issuedDate ? <span>· issued {fmtDate(po.issuedDate)}</span> : null}
        </div>
      </header>

      {overReceipt ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--tone-critical-fg)]/30 p-4"
          style={{ background: 'var(--tone-critical-bg)' }}
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--tone-critical-fg)' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--tone-critical-fg)' }}>Over-receipt refused</p>
            <p className="mt-0.5 text-sm" style={{ color: 'var(--tone-critical-fg)' }}>{overReceipt}</p>
          </div>
        </div>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
              <th className="px-4 py-3 font-semibold">Line</th>
              <th className="px-4 py-3 font-semibold">Ordered</th>
              <th className="px-4 py-3 font-semibold">Received</th>
              {receivable && canReceive ? <th className="px-4 py-3 font-semibold">Receive now</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {po.lines.map((l) => {
              const ordered = Number(l.quantity);
              const received = Number(l.receivedQuantity);
              const remaining = ordered - received;
              const pct = ordered ? Math.round((received / ordered) * 100) : 0;
              return (
                <tr key={l.id}>
                  <td className="px-4 py-3">
                    {l.description}
                    <p className="text-xs text-[var(--color-content-subtle)] tabular-nums">
                      @ {Number(l.unitPrice).toLocaleString()}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{ordered}</td>
                  <td className="px-4 py-3">
                    <div className="min-w-28">
                      <span className="text-xs font-semibold tabular-nums">{received}/{ordered}</span>
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--color-surface-sunken)]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: pct >= 100 ? 'var(--tone-success-solid)' : 'var(--color-brand)',
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  {receivable && canReceive ? (
                    <td className="px-4 py-3">
                      <input
                        aria-label={`Receive quantity for line ${l.lineNumber}`}
                        type="number"
                        min={0}
                        max={remaining}
                        value={receiveQty[l.id] ?? 0}
                        onChange={(e) =>
                          setReceiveQty((prev) => ({ ...prev, [l.id]: Math.max(0, Number(e.target.value)) }))
                        }
                        className={`${inputCls} w-24`}
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        {po.status === 'DRAFT' && can(PERMISSIONS.PROCUREMENT_PO_ISSUE) ? (
          <Button loading={issue.isPending} onClick={() => issue.mutate()}>
            <Send className="size-4" /> Issue to vendor
          </Button>
        ) : null}

        {receivable && canReceive ? (
          <>
            <div>
              <label htmlFor="grn-intake" className="mb-1 block text-[13px] font-medium">Intake</label>
              <select
                id="grn-intake"
                value={intake}
                onChange={(e) => setIntake(e.target.value as 'STOCK' | 'ASSET')}
                className={inputCls}
              >
                <option value="ASSET">Record for asset registration</option>
                <option value="STOCK">Put into stock</option>
              </select>
            </div>
            {intake === 'STOCK' ? (
              <>
                <div>
                  <label htmlFor="grn-loc" className="mb-1 block text-[13px] font-medium">Location</label>
                  <select id="grn-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
                    <option value="">Choose…</option>
                    {(refs.data?.locations ?? []).map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="grn-item" className="mb-1 block text-[13px] font-medium">Stock item</label>
                  <select id="grn-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
                    <option value="">Choose…</option>
                    {(refs.data?.items ?? []).map((i) => (
                      <option key={i.id} value={i.id}>{i.name}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : null}
            <Button loading={receive.isPending} disabled={!anyQty || !stockRefsOk} onClick={() => receive.mutate()}>
              <PackageCheck className="size-4" /> Receive goods
            </Button>
          </>
        ) : null}
      </Card>

      {po.receipts.length > 0 ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Goods receipts</h2>
          <ul className="mt-2 grid gap-1.5">
            {po.receipts.map((r) => (
              <li key={r.id} className="text-sm text-[var(--color-content-muted)]">
                <span className="font-medium text-[var(--color-content)]">{r.grnNumber}</span> ·{' '}
                {r.lines.reduce((s2, l) => s2 + Number(l.quantity), 0)} unit(s) · {fmtDate(r.receivedAt)}
                {r.notes ? ` · ${r.notes}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
