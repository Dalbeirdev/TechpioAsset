'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Cable,
  Headphones,
  Keyboard,
  Laptop,
  Monitor,
  Mouse,
  Package,
  Plus,
  Printer,
  Router,
  Server,
  Smartphone,
  Tablet,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * The equipment kit (v2.21).
 *
 * A person is never issued only a laptop - there is a screen, a phone, a mouse,
 * a cable. The register already knows this: every one of those is an asset with
 * its own serial, warranty and custody history, all pointing at the same holder.
 * So the kit is a VIEW over that, not a second table of loose rows: nothing here
 * can drift from the asset it describes, because it is the asset.
 *
 * Used twice - on a person (everything they hold) and on an asset (everything
 * else the same person holds, so a laptop page answers "what else did they get").
 */

interface KitAsset {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  macAddress: string | null;
  imei: string | null;
  status: string;
  assignmentDate: string | null;
  category: { name: string } | null;
  subcategory: { key: string; name: string } | null;
}

/** Type key -> glyph. Unknown types fall back to a generic box, never blank. */
const TYPE_ICONS: Record<string, LucideIcon> = {
  laptop: Laptop,
  desktop: Server,
  monitor: Monitor,
  'mobile-phone': Smartphone,
  tablet: Tablet,
  keyboard: Keyboard,
  mouse: Mouse,
  headset: Headphones,
  printer: Printer,
  scanner: Printer,
  server: Server,
  'network-switch': Router,
  firewall: Router,
  'wireless-access-point': Router,
  cable: Cable,
  adapter: Cable,
  charger: Cable,
};

function typeIcon(key: string | undefined): LucideIcon {
  return (key && TYPE_ICONS[key]) || Package;
}

/** Serial is the usual identifier; a phone is known by its IMEI, a NIC by MAC. */
function identifierOf(a: KitAsset): { label: string; value: string } | null {
  if (a.serialNumber) return { label: 'SN', value: a.serialNumber };
  if (a.imei) return { label: 'IMEI', value: a.imei };
  if (a.macAddress) return { label: 'MAC', value: a.macAddress };
  return null;
}

/** A consumable the person holds: counted, not serialised. */
interface HeldConsumable {
  inventoryItemId: string;
  quantity: number;
  sku: string;
  name: string;
  unit: string;
  subcategory: { key: string; name: string } | null;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export function EquipmentKit({
  holderId,
  holderName,
  excludeAssetId,
  title = 'Extra Assets',
  emptyMessage = 'No other equipment is issued to this person.',
}: {
  holderId: string;
  holderName: string | null;
  /** Omit the asset whose page this is - it is not "extra" to itself. */
  excludeAssetId?: string;
  title?: string;
  emptyMessage?: string;
}) {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);

  const kit = useQuery({
    queryKey: ['equipment-kit', holderId],
    queryFn: () => apiFetchPage<KitAsset>(`/assets?assignedUserId=${holderId}&pageSize=100`),
    enabled: Boolean(holderId),
  });

  const rows = (kit.data?.data ?? []).filter((a) => a.id !== excludeAssetId);

  // v2.21 - cables and spare mice are stock, not serialised assets. They are
  // held by the same person, so they belong in the same table; the ledger is
  // the source, so the count cannot disagree with the movements behind it.
  const consumables = useQuery({
    queryKey: ['held-consumables', holderId],
    queryFn: () => apiFetch<HeldConsumable[]>(`/stock/held-by/${holderId}`),
    enabled: Boolean(holderId),
  });
  const stockRows = consumables.data ?? [];
  const totalItems = rows.length + stockRows.length;

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {kit.isPending ? null : (
          <span className="rounded-full bg-[var(--color-surface-sunken)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-content-muted)]">
            {totalItems} {totalItems === 1 ? 'item' : 'items'}
          </span>
        )}
        {can(PERMISSIONS.ASSETS_ASSIGN) ? (
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="mr-1.5 size-4" />
            Add extra asset
          </Button>
        ) : null}
      </div>

      {kit.isPending ? (
        <div className="grid gap-2 p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : totalItems === 0 ? (
        <EmptyState title="Nothing else issued" description={emptyMessage} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Equipment issued to {holderName ?? 'this person'}, {totalItems} items
            </caption>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th scope="col" className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Asset type
                </th>
                <th scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Qty
                </th>
                <th scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Brand
                </th>
                <th scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Model
                </th>
                <th scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Serial no. / identifier
                </th>
                <th scope="col" className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  Issued
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const Icon = typeIcon(a.subcategory?.key);
                const ident = identifierOf(a);
                return (
                  <tr key={a.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
                          <Icon aria-hidden="true" className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <Link href={`/assets/${a.id}`} className="font-medium hover:underline">
                            {a.subcategory?.name ?? a.category?.name ?? 'Asset'}
                          </Link>
                          <p className="truncate text-xs text-[var(--color-content-muted)]">{a.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">1</td>
                    <td className="px-3 py-3">{a.brand ?? '—'}</td>
                    <td className="px-3 py-3">{a.model ?? '—'}</td>
                    <td className="px-3 py-3">
                      {ident ? (
                        <span className="font-mono text-xs">
                          <span className="text-[var(--color-content-subtle)]">{ident.label} </span>
                          {ident.value}
                        </span>
                      ) : (
                        <span className="text-[var(--color-content-subtle)]">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-[var(--color-content-muted)]">
                      {fmtDate(a.assignmentDate)}
                    </td>
                  </tr>
                );
              })}
              {stockRows.map((c) => {
                const Icon = typeIcon(c.subcategory?.key);
                return (
                  <tr key={c.inventoryItemId} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]">
                          <Icon aria-hidden="true" className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium">{c.subcategory?.name ?? 'Consumable'}</p>
                          <p className="truncate text-xs text-[var(--color-content-muted)]">{c.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums font-medium">{c.quantity}</td>
                    <td className="px-3 py-3 text-[var(--color-content-subtle)]">—</td>
                    <td className="px-3 py-3 text-[var(--color-content-subtle)]">{c.sku}</td>
                    <td className="px-3 py-3">
                      <span className="text-xs text-[var(--color-content-subtle)]">
                        Stock item · not serialised
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[var(--color-content-muted)]">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <AddExtraAssetDialog
          holderId={holderId}
          holderName={holderName}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Card>
  );
}

/**
 * Hand an available asset to the same person. Deliberately a picker over the
 * real register rather than a "type what you gave them" box: the row that
 * appears in the kit is the asset itself, with its serial and history intact.
 */
function AddExtraAssetDialog({
  holderId,
  holderName,
  onClose,
}: {
  holderId: string;
  holderName: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');

  const available = useQuery({
    queryKey: ['available-assets', q],
    queryFn: () =>
      apiFetchPage<KitAsset>(`/assets?status=AVAILABLE&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });

  const assign = useMutation({
    mutationFn: (assetId: string) =>
      apiFetch(`/assets/${assetId}/assign`, { method: 'POST', body: { userId: holderId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['equipment-kit', holderId] });
      void queryClient.invalidateQueries({ queryKey: ['available-assets'] });
      toast.success(`Issued to ${holderName ?? 'the holder'}`);
      onClose();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not issue that asset');
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add extra asset"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-base font-semibold">Issue another asset</h3>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            Pick from equipment that is currently available. It keeps its own serial and history.
          </p>
          <Input
            className="mt-3"
            placeholder="Search by name, tag or serial…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="max-h-[45vh] overflow-y-auto p-2">
          {available.isPending ? (
            <div className="grid gap-2 p-3">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (available.data?.data.length ?? 0) === 0 ? (
            <p className="p-5 text-center text-sm text-[var(--color-content-muted)]">
              Nothing available to issue{q ? ' for that search' : ''}.
            </p>
          ) : (
            available.data!.data.map((a) => {
              const Icon = typeIcon(a.subcategory?.key);
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={assign.isPending}
                  onClick={() => assign.mutate(a.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--color-surface-sunken)] disabled:opacity-60"
                >
                  <span className="grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    <span className="block truncate text-xs text-[var(--color-content-muted)]">
                      {a.assetTag}
                      {a.serialNumber ? ` · SN ${a.serialNumber}` : ''}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
