'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Plus } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { TonePill, fmtDate, inputCls } from '@/components/procurement/shared';

interface Level {
  id: string;
  quantity: string;
  reserved: string;
  inventoryItem: { id: string; sku: string; name: string; unit: string; minStock: string | null };
  stockLocation: { id: string; code: string; name: string };
}
interface Movement {
  id: string;
  type: string;
  quantity: string;
  reason: string | null;
  refType: string | null;
  createdAt: string;
  inventoryItem: { sku: string; name: string };
  stockLocationId: string;
}
interface Location {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  _count: { levels: number };
}
/** v2.9 C4 - a lot of one item at one location. */
interface Batch {
  id: string;
  batchNumber: string;
  quantity: string;
  expiryDate: string | null;
  receivedAt: string;
  expiryState: 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';
  inventoryItem: { id: string; sku: string; name: string };
  stockLocation: { id: string; name: string };
}
interface Item {
  id: string;
  name: string;
}

const MOVEMENT_TONE: Record<string, string> = {
  RECEIPT: 'success',
  ISSUE: 'progress',
  ADJUST_UP: 'info',
  ADJUST_DOWN: 'warning',
  TRANSFER_IN: 'info',
  TRANSFER_OUT: 'warning',
  CONVERT_TO_ASSET: 'neutral',
};

export default function InventoryPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'levels' | 'batches' | 'ledger' | 'locations'>('levels');

  // Adjust / transfer form state (inline panel, one at a time).
  const [action, setAction] = useState<'adjust' | 'transfer' | null>(null);
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState('');

  // v2.9 C4 - lots on the shelf, soonest expiry first.
  const batches = useQuery({
    queryKey: ['stock-batches'],
    queryFn: () => apiFetch<Batch[]>('/stock/batches'),
  });
  const levels = useQuery({
    queryKey: ['stock-levels'],
    queryFn: () => apiFetch<Level[]>('/stock/levels'),
  });
  const locations = useQuery({
    queryKey: ['stock-locations'],
    queryFn: () => apiFetch<Location[]>('/stock/locations'),
  });
  const items = useQuery({
    queryKey: ['stock-items'],
    queryFn: () => apiFetch<Item[]>('/stock/items'),
  });
  const ledger = useQuery({
    queryKey: ['stock-ledger'],
    queryFn: () => apiFetchPage<Movement>('/stock/movements?pageSize=50'),
    enabled: tab === 'ledger',
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['stock-levels'] });
    void qc.invalidateQueries({ queryKey: ['stock-ledger'] });
  };

  const run = useMutation({
    mutationFn: () => {
      if (action === 'adjust') {
        return apiFetch('/stock/adjust', {
          method: 'POST',
          body: { inventoryItemId: itemId, stockLocationId: locationId, delta: amount, reason: reason.trim() },
        });
      }
      return apiFetch('/stock/transfer', {
        method: 'POST',
        body: {
          inventoryItemId: itemId,
          fromLocationId: locationId,
          toLocationId,
          quantity: Math.abs(amount),
          note: reason.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(action === 'adjust' ? 'Stock adjusted' : 'Stock transferred');
      setAction(null);
      setReason('');
      refresh();
    },
    // Guarded refusals (insufficient stock, reservations) speak verbatim.
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update stock'),
  });

  const canAdjust = can(PERMISSIONS.INVENTORY_ADJUST);
  const canTransfer = can(PERMISSIONS.INVENTORY_TRANSFER);
  const validForm =
    itemId &&
    locationId &&
    (action === 'adjust'
      ? amount !== 0 && reason.trim().length >= 5
      : amount > 0 && toLocationId && toLocationId !== locationId);

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
            Warehouse
          </span>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
            <Boxes className="size-6 text-[var(--color-brand)]" /> Inventory
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            The movement ledger is the record; levels are its rollup, never edited directly.
          </p>
        </div>
        <div className="flex gap-2">
          {canAdjust ? (
            <Button variant="ghost" onClick={() => setAction(action === 'adjust' ? null : 'adjust')}>
              Adjust
            </Button>
          ) : null}
          {canTransfer ? (
            <Button variant="ghost" onClick={() => setAction(action === 'transfer' ? null : 'transfer')}>
              Transfer
            </Button>
          ) : null}
        </div>
      </header>

      {action ? (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="inv-item" className="mb-1 block text-[13px] font-medium">Item</label>
            <select id="inv-item" value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
              <option value="">Choose…</option>
              {(items.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="inv-loc" className="mb-1 block text-[13px] font-medium">
              {action === 'transfer' ? 'From location' : 'Location'}
            </label>
            <select id="inv-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
              <option value="">Choose…</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          {action === 'transfer' ? (
            <div>
              <label htmlFor="inv-to" className="mb-1 block text-[13px] font-medium">To location</label>
              <select id="inv-to" value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} className={inputCls}>
                <option value="">Choose…</option>
                {(locations.data ?? [])
                  .filter((l) => l.id !== locationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor="inv-qty" className="mb-1 block text-[13px] font-medium">
              {action === 'adjust' ? 'Delta (+/−)' : 'Quantity'}
            </label>
            <input
              id="inv-qty"
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className={`${inputCls} w-28`}
            />
          </div>
          <div className="min-w-56 flex-1">
            <label htmlFor="inv-reason" className="mb-1 block text-[13px] font-medium">
              {action === 'adjust' ? 'Reason (required)' : 'Note'}
            </label>
            <input
              id="inv-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={action === 'adjust' ? 'Adjustments are audited' : 'Optional'}
              className={inputCls}
            />
          </div>
          <Button loading={run.isPending} disabled={!validForm} onClick={() => run.mutate()}>
            <Plus className="size-4" /> {action === 'adjust' ? 'Post adjustment' : 'Move stock'}
          </Button>
        </Card>
      ) : null}

      <div role="tablist" aria-label="Inventory sections" className="flex gap-1 border-b border-[var(--color-border)]">
        {(
          [
            ['levels', 'Stock levels'],
            ['batches', 'Lots & expiry'],
            ['ledger', 'Ledger'],
            ['locations', 'Locations'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-transparent text-[var(--color-content-muted)] hover:text-[var(--color-content)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'levels' ? (
        levels.isPending ? (
          <Skeleton className="h-64" />
        ) : levels.isError ? (
          <ErrorState title="Could not load stock" detail={(levels.error as Error).message} />
        ) : levels.data.length === 0 ? (
          <Card className="p-8">
            <EmptyState title="No stock yet" description="Receive a purchase order into a location, or post an adjustment." />
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">On hand</th>
                  <th className="px-4 py-3 font-semibold">Reserved</th>
                  <th className="px-4 py-3 font-semibold">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {levels.data.map((l) => {
                  const qty = Number(l.quantity);
                  const reserved = Number(l.reserved);
                  const low = l.inventoryItem.minStock !== null && qty <= Number(l.inventoryItem.minStock);
                  return (
                    <tr key={l.id} className="hover:bg-[var(--color-surface-sunken)]">
                      <td className="px-4 py-3">
                        {l.inventoryItem.name}
                        <p className="text-xs text-[var(--color-content-subtle)]">{l.inventoryItem.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-content-muted)]">{l.stockLocation.name}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {qty} {low ? <TonePill label="low" tone="warning" /> : null}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{reserved}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums">{Math.max(0, qty - reserved)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )
      ) : null}

      {tab === 'batches' ? (
        batches.isPending ? (
          <Skeleton className="h-64" />
        ) : batches.isError ? (
          <ErrorState title="Could not load lots" detail={(batches.error as Error).message} />
        ) : batches.data.length === 0 ? (
          <Card className="p-8">
            <EmptyState
              title="No lots on the shelf"
              description="Lots appear when a batch-tracked item is received with the batch number from the box."
            />
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                  <th className="px-4 py-3 font-semibold">Lot</th>
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">On hand</th>
                  <th className="px-4 py-3 font-semibold">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {batches.data.map((b) => (
                  <tr key={b.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-3 font-medium">{b.batchNumber}</td>
                    <td className="px-4 py-3">
                      {b.inventoryItem.name}
                      <p className="text-xs text-[var(--color-content-subtle)]">{b.inventoryItem.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-content-muted)]">{b.stockLocation.name}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(b.quantity)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[var(--color-content-muted)]">{fmtDate(b.expiryDate)}</span>
                        {b.expiryState === 'EXPIRED' ? <TonePill label="expired" tone="critical" /> : null}
                        {b.expiryState === 'EXPIRING_SOON' ? <TonePill label="expiring" tone="warning" /> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-content-subtle)]">
              Issuing draws on these lots oldest-expiry-first. Expired stock is refused unless somebody
              records a reason for using it anyway.
            </p>
          </Card>
        )
      ) : null}

      {tab === 'ledger' ? (
        ledger.isPending ? (
          <Skeleton className="h-64" />
        ) : ledger.isError ? (
          <ErrorState title="Could not load the ledger" detail={(ledger.error as Error).message} />
        ) : (
          <Card className="p-0">
            {ledger.data!.data.length === 0 ? (
              <EmptyState title="No movements yet" description="Every stock change lands here, append-only." />
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {ledger.data!.data.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">
                        <TonePill label={m.type} tone={MOVEMENT_TONE[m.type] ?? 'neutral'} />{' '}
                        <span className="font-medium">{m.inventoryItem.name}</span>{' '}
                        <span className="tabular-nums">× {Number(m.quantity)}</span>
                      </p>
                      <p className="text-xs text-[var(--color-content-subtle)]">
                        {m.reason ?? m.refType ?? ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--color-content-subtle)]">
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      ) : null}

      {tab === 'locations' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(locations.data ?? []).map((l) => (
            <Card key={l.id} className="p-4">
              <p className="font-semibold">{l.name}</p>
              <p className="text-xs text-[var(--color-content-subtle)]">
                {l.code} · {l._count.levels} item(s) {l.isActive ? '' : '· inactive'}
              </p>
            </Card>
          ))}
          {can(PERMISSIONS.INVENTORY_LOCATIONS_MANAGE) ? <NewLocationCard onCreated={() => void qc.invalidateQueries({ queryKey: ['stock-locations'] })} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function NewLocationCard({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => apiFetch('/stock/locations', { method: 'POST', body: { code: code.trim(), name: name.trim() } }),
    onSuccess: () => {
      toast.success('Location created');
      setCode('');
      setName('');
      onCreated();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create'),
  });
  return (
    <Card className="grid gap-2 p-4">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
        New location
      </p>
      <input aria-label="Location code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code (e.g. WH-BLR)" className={inputCls} />
      <input aria-label="Location name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inputCls} />
      <Button size="sm" loading={create.isPending} disabled={code.trim().length < 2 || name.trim().length < 2} onClick={() => create.mutate()}>
        <Plus className="size-3.5" /> Create
      </Button>
    </Card>
  );
}
