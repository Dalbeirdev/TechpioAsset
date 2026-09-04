'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Store, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls as inputCls, Skeleton } from '@/components/ui';

/**
 * Vendor management (v2.40).
 *
 * `vendors:manage` was granted to Finance and Procurement Manager and enforced
 * by nothing: every picker in the app read vendors, and nothing could create
 * one. The only row a company ever had was the "Unknown vendor" placeholder an
 * uploaded bill falls back to, so a purchase order could only name a vendor
 * nobody had chosen. This is the missing write side.
 *
 * Deliberately mirrors the offices page: same shape, same words for the same
 * actions, because these are the same job done to a different noun.
 */

type Vendor = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  taxId: string | null;
  addressLine1: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  isActive: boolean;
  /** How much history points at this vendor, which decides whether it can go. */
  _count: { invoices: number; purchaseOrders: number };
};

type Draft = Omit<Vendor, 'id' | 'isActive' | '_count'>;

const EMPTY: Draft = {
  code: '',
  name: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  website: '',
  taxId: '',
  addressLine1: '',
  city: '',
  country: '',
  notes: '',
};

function VendorForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  busy: boolean;
  submitLabel: string;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const field = (key: keyof Draft, label: string, placeholder?: string) => (
    <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
      {label}
      <input
        value={draft[key] ?? ''}
        onChange={set(key)}
        placeholder={placeholder}
        className={inputCls}
      />
    </label>
  );

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {field('code', 'Code', 'e.g. SCS')}
        {field('name', 'Name', 'e.g. Sharma Computer Systems')}
        {field('contactName', 'Contact person')}
        {field('contactEmail', 'Contact email')}
        {field('contactPhone', 'Contact phone')}
        {field('taxId', 'GSTIN / tax number')}
        {field('addressLine1', 'Address')}
        {field('city', 'City')}
        {field('country', 'Country')}
        {field('website', 'Website')}
        {field('notes', 'Notes')}
      </div>
      {/* Only a code and a name are required. A vendor is usually added in the
          middle of a purchase, and refusing the record until somebody finds the
          GSTIN is how everything ends up filed under "Unknown vendor". */}
      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={!draft.code.trim() || !draft.name.trim()}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function VendorsSettingsPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const allowed = can(PERMISSIONS.VENDORS_MANAGE);

  const { data: vendors, isLoading } = useQuery({
    queryKey: ['vendors', 'manage'],
    queryFn: () => apiFetch<Vendor[]>('/vendors/manage'),
    enabled: allowed,
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['vendors', 'manage'] }),
      // The picker list is cached server-side too; this clears the client half.
      qc.invalidateQueries({ queryKey: ['vendors'] }),
    ]);
  };

  // Empty strings become nulls at the edge: "no phone number" should be stored
  // as absence, not as ''.
  const clean = (draft: Draft) =>
    Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]),
    );

  const create = useMutation({
    mutationFn: (draft: Draft) => apiFetch('/vendors', { method: 'POST', body: clean(draft) }),
    onSuccess: async () => {
      toast.success('Vendor added');
      setAdding(false);
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the vendor'),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/vendors/${id}`, { method: 'PATCH', body }),
    onSuccess: async () => {
      toast.success('Vendor updated');
      setEditingId(null);
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the vendor'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/vendors/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Vendor deleted');
      await invalidate();
    },
    // The server refuses to delete a vendor with history and says to deactivate
    // instead; that message is more useful than anything generic written here.
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete the vendor'),
  });

  if (!user) return <Skeleton className="h-96" />;
  if (!allowed) {
    return (
      <Card className="mx-auto mt-10 max-w-md p-6 text-sm text-[var(--color-content-muted)]">
        Managing vendors needs the vendors permission. Ask your administrator.
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Store aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Vendors
          </h1>
          <p className="text-sm text-[var(--color-content-muted)]">
            The suppliers you raise orders with and receive bills from. Deactivating a vendor hides
            it from pickers without touching any existing order or invoice.
          </p>
        </div>
        {!adding ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="mr-1 size-4" /> Add vendor
          </Button>
        ) : null}
      </header>

      {adding ? (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">New vendor</h2>
          <VendorForm
            initial={EMPTY}
            busy={create.isPending}
            submitLabel="Add vendor"
            onSubmit={(draft) => create.mutate(draft)}
            onCancel={() => setAdding(false)}
          />
        </Card>
      ) : null}

      {isLoading ? <Skeleton className="h-48" /> : null}

      {!isLoading && (vendors ?? []).length === 0 ? (
        <Card className="p-6 text-sm text-[var(--color-content-muted)]">
          No vendors yet. Add the suppliers you buy from, so a purchase order can name the right
          one instead of falling back to “Unknown vendor”.
        </Card>
      ) : null}

      {(vendors ?? []).map((vendor) => {
        const history = vendor._count.invoices + vendor._count.purchaseOrders;
        return (
          <Card key={vendor.id} className="p-5">
            {editingId === vendor.id ? (
              <VendorForm
                initial={{
                  code: vendor.code,
                  name: vendor.name,
                  contactName: vendor.contactName ?? '',
                  contactEmail: vendor.contactEmail ?? '',
                  contactPhone: vendor.contactPhone ?? '',
                  website: vendor.website ?? '',
                  taxId: vendor.taxId ?? '',
                  addressLine1: vendor.addressLine1 ?? '',
                  city: vendor.city ?? '',
                  country: vendor.country ?? '',
                  notes: vendor.notes ?? '',
                }}
                busy={update.isPending}
                submitLabel="Save changes"
                onSubmit={(draft) => update.mutate({ id: vendor.id, body: clean(draft) })}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {vendor.name}
                    <span className="rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono text-[11px] font-normal">
                      {vendor.code}
                    </span>
                    {!vendor.isActive ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: 'var(--tone-warning-bg)',
                          color: 'var(--tone-warning-fg)',
                        }}
                      >
                        Inactive
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-[var(--color-content-subtle)]">
                    {[vendor.contactName, vendor.contactEmail, vendor.city, vendor.country]
                      .filter(Boolean)
                      .join(' · ') || 'No contact details on file'}
                    {vendor.taxId ? ` · ${vendor.taxId}` : ''}
                  </p>
                  {history > 0 ? (
                    <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                      {vendor._count.purchaseOrders} order(s), {vendor._count.invoices} bill(s) —
                      deactivate rather than delete, so the history stays.
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingId(vendor.id)}>
                    <Pencil aria-hidden="true" className="mr-1 size-3.5" /> Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={update.isPending && update.variables?.id === vendor.id}
                    onClick={() =>
                      update.mutate({ id: vendor.id, body: { isActive: !vendor.isActive } })
                    }
                  >
                    {vendor.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                  {/* Only offered where it can actually succeed. The server
                      refuses either way, but offering a button that always
                      fails is worse than not offering it. */}
                  {history === 0 ? (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={remove.isPending && remove.variables === vendor.id}
                      onClick={() => {
                        if (confirm(`Delete ${vendor.name}? This cannot be undone.`)) {
                          remove.mutate(vendor.id);
                        }
                      }}
                    >
                      <Trash2 aria-hidden="true" className="mr-1 size-3.5" /> Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
