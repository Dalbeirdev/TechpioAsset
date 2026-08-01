'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Field, Input } from '@/components/ui';
import { Textarea } from '@/components/ui/textarea';
import { inputCls } from '@/components/licenses/shared';

const FAMILIES = [
  ['PRODUCTIVITY_SUITE', 'Productivity suite'],
  ['OPERATING_SYSTEM', 'Operating system'],
  ['SECURITY', 'Security'],
  ['DEVELOPER_TOOLS', 'Developer tools'],
  ['DESIGN_CREATIVE', 'Design & creative'],
  ['SAAS', 'SaaS'],
  ['DATABASE_SERVER', 'Database / server'],
  ['OTHER', 'Other'],
] as const;

export default function NewLicensePage() {
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    family: 'SAAS',
    subscriptionType: 'SUBSCRIPTION',
    edition: '',
    vendorId: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    expiryDate: '',
    autoRenewal: false,
    seatsPurchased: 10,
    unitOfAssignment: 'USER',
    costAmount: '',
    costCurrency: 'USD',
    notes: '',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const canSeeCost = can(PERMISSIONS.LICENSES_COST_READ);
  const vendors = useQuery({
    queryKey: ['vendors-for-license'],
    queryFn: () => apiFetchPage<{ id: string; name: string }>('/vendors?pageSize=100'),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/licenses', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          family: form.family,
          subscriptionType: form.subscriptionType,
          edition: form.edition.trim() || null,
          vendorId: form.vendorId || null,
          purchaseDate: form.purchaseDate,
          expiryDate: form.expiryDate || null,
          autoRenewal: form.autoRenewal,
          seatsPurchased: form.seatsPurchased,
          unitOfAssignment: form.unitOfAssignment,
          ...(canSeeCost && form.costAmount
            ? { costAmount: form.costAmount, costCurrency: form.costCurrency }
            : {}),
          notes: form.notes.trim() || null,
        },
      }),
    onSuccess: (license) => {
      toast.success('License registered');
      router.push(`/licenses/${license.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create the license'),
  });

  if (!can(PERMISSIONS.LICENSES_CREATE)) {
    return <ErrorState title="Not available" detail="You need the Create licenses permission." />;
  }

  const perpetual = form.subscriptionType === 'PERPETUAL';
  const valid =
    form.name.trim().length >= 2 && form.seatsPurchased >= 0 && (perpetual || form.expiryDate);

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
          Software
        </span>
        <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
          <KeyRound className="size-6 text-[var(--color-brand)]" /> New license
        </h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Every purchased seat becomes an enforceable slot in the default pool.
        </p>
      </header>

      <Card className="grid gap-4 p-6">
        <Field label="Name" htmlFor="lic-name">
          <Input
            id="lic-name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Microsoft 365 E3"
            maxLength={200}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Family" htmlFor="lic-family">
            <select
              id="lic-family"
              value={form.family}
              onChange={(e) => set('family', e.target.value)}
              className={inputCls}
            >
              {FAMILIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Edition" htmlFor="lic-edition">
            <Input
              id="lic-edition"
              value={form.edition}
              onChange={(e) => set('edition', e.target.value)}
              placeholder="e.g. E3, Enterprise"
              maxLength={120}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Subscription type" htmlFor="lic-sub">
            <select
              id="lic-sub"
              value={form.subscriptionType}
              onChange={(e) => set('subscriptionType', e.target.value)}
              className={inputCls}
            >
              <option value="SUBSCRIPTION">Subscription</option>
              <option value="PERPETUAL">Perpetual</option>
              <option value="OEM">OEM</option>
              <option value="VOLUME">Volume</option>
              <option value="OPEN">Open licence</option>
            </select>
          </Field>
          <Field label="Vendor" htmlFor="lic-vendor">
            <select
              id="lic-vendor"
              value={form.vendorId}
              onChange={(e) => set('vendorId', e.target.value)}
              className={inputCls}
            >
              <option value="">—</option>
              {(vendors.data?.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purchase date" htmlFor="lic-purchased">
            <Input
              id="lic-purchased"
              type="date"
              value={form.purchaseDate}
              onChange={(e) => set('purchaseDate', e.target.value)}
            />
          </Field>
          <Field
            label={perpetual ? 'Expiry date (not needed)' : 'Expiry date'}
            htmlFor="lic-expiry"
          >
            <Input
              id="lic-expiry"
              type="date"
              value={form.expiryDate}
              disabled={perpetual}
              onChange={(e) => set('expiryDate', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Seats purchased" htmlFor="lic-seats">
            <Input
              id="lic-seats"
              type="number"
              min={0}
              value={form.seatsPurchased}
              onChange={(e) => set('seatsPurchased', Math.max(0, Number(e.target.value)))}
            />
          </Field>
          <Field label="Assigned per" htmlFor="lic-unit">
            <select
              id="lic-unit"
              value={form.unitOfAssignment}
              onChange={(e) => set('unitOfAssignment', e.target.value)}
              className={inputCls}
            >
              <option value="USER">User</option>
              <option value="DEVICE">Device</option>
            </select>
          </Field>
        </div>

        {canSeeCost ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cost (optional)" htmlFor="lic-cost">
              <Input
                id="lic-cost"
                inputMode="decimal"
                placeholder="e.g. 4999.00"
                value={form.costAmount}
                onChange={(e) => set('costAmount', e.target.value)}
              />
            </Field>
            <Field label="Currency" htmlFor="lic-currency">
              <Input
                id="lic-currency"
                value={form.costCurrency}
                maxLength={3}
                onChange={(e) => set('costCurrency', e.target.value.toUpperCase())}
              />
            </Field>
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.autoRenewal}
            onChange={(e) => set('autoRenewal', e.target.checked)}
            className="size-4 accent-[var(--color-brand)]"
          />
          Auto-renews with the vendor
        </label>

        <Field label="Notes" htmlFor="lic-notes">
          <Textarea
            id="lic-notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            maxLength={2000}
          />
        </Field>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-4">
          <Button variant="ghost" onClick={() => router.push('/licenses')}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
            Register license
          </Button>
        </div>
      </Card>
    </div>
  );
}
