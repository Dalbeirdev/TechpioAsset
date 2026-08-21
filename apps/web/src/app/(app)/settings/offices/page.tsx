'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, controlCls as inputCls, Skeleton } from '@/components/ui';

/**
 * Office management (v2.11). Offices were seed-only reference data until now:
 * every picker in the app read them, nothing could create one. This page is
 * the missing write side — add an office, fix its details, or deactivate it
 * (which hides it from pickers without unlinking the people already in it).
 */

type Office = {
  id: string;
  code: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  timezone: string | null;
  isActive: boolean;
};

type Draft = Omit<Office, 'id' | 'isActive'>;

const EMPTY: Draft = {
  code: '',
  name: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  timezone: '',
};



function OfficeForm({
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
        {field('code', 'Code', 'e.g. BLR-HQ')}
        {field('name', 'Name', 'e.g. Bengaluru HQ')}
        {field('addressLine1', 'Address line 1')}
        {field('addressLine2', 'Address line 2')}
        {field('city', 'City')}
        {field('region', 'State / region')}
        {field('postalCode', 'Postal code')}
        {field('country', 'Country')}
        {field('timezone', 'Timezone', 'e.g. Asia/Kolkata')}
      </div>
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

export default function OfficesSettingsPage() {
  const { user, can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const allowed = can(PERMISSIONS.SETTINGS_MANAGE);

  const { data: offices, isLoading } = useQuery({
    queryKey: ['offices', 'manage'],
    queryFn: () => apiFetch<Office[]>('/offices/manage'),
    enabled: allowed,
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['offices', 'manage'] }),
      qc.invalidateQueries({ queryKey: ['offices'] }),
    ]);
  };

  // Empty strings become nulls at the edge: "no address" should be stored as
  // absence, not as ''.
  const clean = (draft: Draft) =>
    Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]),
    );

  const create = useMutation({
    mutationFn: (draft: Draft) => apiFetch('/offices', { method: 'POST', body: clean(draft) }),
    onSuccess: async () => {
      toast.success('Office added');
      setAdding(false);
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not add the office'),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/offices/${id}`, { method: 'PATCH', body }),
    onSuccess: async () => {
      toast.success('Office updated');
      setEditingId(null);
      await invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not update the office'),
  });

  if (!user) return <Skeleton className="h-96" />;
  if (!allowed) {
    return (
      <Card className="mx-auto mt-10 max-w-md p-6 text-sm text-[var(--color-content-muted)]">
        Managing offices needs the settings permission. Ask your administrator.
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Building2 aria-hidden="true" className="size-5 text-[var(--color-brand)]" /> Offices
          </h1>
          <p className="text-sm text-[var(--color-content-muted)]">
            The locations people and assets belong to. Deactivating an office hides it from
            pickers without unlinking anyone.
          </p>
        </div>
        {!adding ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" className="mr-1 size-4" /> Add office
          </Button>
        ) : null}
      </header>

      {adding ? (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">New office</h2>
          <OfficeForm
            initial={EMPTY}
            busy={create.isPending}
            submitLabel="Add office"
            onSubmit={(draft) => create.mutate(draft)}
            onCancel={() => setAdding(false)}
          />
        </Card>
      ) : null}

      {isLoading ? <Skeleton className="h-48" /> : null}

      {(offices ?? []).map((office) => (
        <Card key={office.id} className="p-5">
          {editingId === office.id ? (
            <OfficeForm
              initial={{
                code: office.code,
                name: office.name,
                addressLine1: office.addressLine1 ?? '',
                addressLine2: office.addressLine2 ?? '',
                city: office.city ?? '',
                region: office.region ?? '',
                postalCode: office.postalCode ?? '',
                country: office.country ?? '',
                timezone: office.timezone ?? '',
              }}
              busy={update.isPending}
              submitLabel="Save changes"
              onSubmit={(draft) => update.mutate({ id: office.id, body: clean(draft) })}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {office.name}
                  <span className="rounded bg-[var(--color-surface-sunken)] px-1.5 py-0.5 font-mono text-[11px] font-normal">
                    {office.code}
                  </span>
                  {!office.isActive ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{ background: 'var(--tone-warning-bg)', color: 'var(--tone-warning-fg)' }}
                    >
                      Inactive
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-[var(--color-content-subtle)]">
                  {[office.addressLine1, office.city, office.region, office.country]
                    .filter(Boolean)
                    .join(', ') || 'No address on file'}
                  {office.timezone ? ` · ${office.timezone}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditingId(office.id)}>
                  <Pencil aria-hidden="true" className="mr-1 size-3.5" /> Edit
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={update.isPending && update.variables?.id === office.id}
                  onClick={() =>
                    update.mutate({ id: office.id, body: { isActive: !office.isActive } })
                  }
                >
                  {office.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
