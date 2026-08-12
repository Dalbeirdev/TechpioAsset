'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';

/**
 * Organisation settings (v2.15). Born from a single circled screenshot: every
 * estimate read "USD" because the company's base currency was the provisioning
 * default and nothing let anyone change it. Currency is a LABEL here, not a
 * conversion - changing it relabels money going forward and converts nothing.
 */

interface CompanySettings {
  name: string;
  legalName: string | null;
  baseCurrency: string;
  timezone: string;
  locale: string;
}

const CURRENCIES: [string, string][] = [
  ['INR', 'INR — Indian Rupee'],
  ['USD', 'USD — US Dollar'],
  ['EUR', 'EUR — Euro'],
  ['GBP', 'GBP — British Pound'],
  ['AED', 'AED — UAE Dirham'],
  ['AUD', 'AUD — Australian Dollar'],
  ['CAD', 'CAD — Canadian Dollar'],
  ['SGD', 'SGD — Singapore Dollar'],
];

const selectCls =
  'h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export default function OrganisationSettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['company-settings'],
    queryFn: () => apiFetch<CompanySettings>('/company'),
  });

  const [form, setForm] = useState<{ name: string; baseCurrency: string } | null>(null);
  const current = settings.data;
  const draft = form ?? {
    name: current?.name ?? '',
    baseCurrency: current?.baseCurrency ?? 'USD',
  };
  const set = (patch: Partial<typeof draft>) => setForm({ ...draft, ...patch });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<CompanySettings>('/company', {
        method: 'PATCH',
        body: { name: draft.name.trim(), baseCurrency: draft.baseCurrency },
      }),
    onSuccess: () => {
      toast.success('Organisation settings saved');
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['company-settings'] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save'),
  });

  if (settings.isPending) return <Skeleton className="mx-auto h-64 max-w-2xl" />;
  if (settings.isError) {
    const forbidden = settings.error instanceof ApiError && settings.error.status === 403;
    return (
      <ErrorState
        title={forbidden ? 'Settings managers only' : 'Could not load settings'}
        detail={
          forbidden
            ? 'Changing organisation settings needs the settings-manage permission.'
            : (settings.error as Error).message
        }
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand)] text-white shadow-sm">
          <Building2 aria-hidden="true" className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organisation</h1>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            Company-wide settings: the name on documents and the currency money is labelled in.
          </p>
        </div>
      </header>

      <Card className="grid gap-4 p-5">
        <Field label="Company name" htmlFor="on">
          <Input id="on" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <div className="max-w-sm">
          <Field label="Base currency" htmlFor="oc">
            <select
              id="oc"
              value={draft.baseCurrency}
              onChange={(e) => set({ baseCurrency: e.target.value })}
              className={selectCls}
            >
              {CURRENCIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
              {CURRENCIES.every(([code]) => code !== draft.baseCurrency) ? (
                <option value={draft.baseCurrency}>{draft.baseCurrency}</option>
              ) : null}
            </select>
          </Field>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            Labels new estimates and prices. Existing figures keep the currency they were recorded
            in — nothing is converted.
          </p>
        </div>

        <div>
          <Button
            size="sm"
            loading={save.isPending}
            disabled={!draft.name.trim()}
            onClick={() => save.mutate()}
          >
            Save settings
          </Button>
        </div>
      </Card>
    </div>
  );
}
