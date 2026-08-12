'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlugZap, Sparkles } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { PasswordInput } from '@/components/ui/password-input';

/**
 * Operator AI provider settings (v2.15). The tenant-facing AI page governs
 * WHETHER and HOW AI is used; this one supplies the provider itself - the
 * missing piece behind "Provider: mock - extraction results are simulated".
 * Same contract as the SMTP console: stored in the database, key encrypted
 * and never returned, effective on the next extraction without a restart.
 */

interface AiSettings {
  configured: boolean;
  provider: string | null;
  endpoint: string | null;
  model: string | null;
  hasKey: boolean;
  effective: { provider: string; source: 'operator' | 'environment' };
}

const PROVIDERS: { key: string; label: string; hint: string }[] = [
  {
    key: 'anthropic',
    label: 'Anthropic Claude',
    hint: 'API key from console.anthropic.com → API keys. Claude reads the invoice and proposes fields and line items; a person always confirms.',
  },
  {
    key: 'azure',
    label: 'Azure Document Intelligence',
    hint: 'Endpoint and key from the Azure portal → your Document Intelligence resource → Keys and Endpoint.',
  },
  {
    key: 'mock',
    label: 'Simulated (no external service)',
    hint: 'Extraction results are generated locally. Nothing ever leaves the server - useful for demos and training.',
  },
];

const selectCls =
  'h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

export default function PlatformAiPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['platform-ai'],
    queryFn: () => apiFetch<AiSettings>('/platform/ai-settings'),
  });

  const [form, setForm] = useState<{
    provider: string;
    endpoint: string;
    model: string;
    apiKey: string;
  } | null>(null);

  const current = settings.data;
  const draft = form ?? {
    provider: current?.provider ?? 'anthropic',
    endpoint: current?.endpoint ?? '',
    model: current?.model ?? '',
    apiKey: '',
  };
  const set = (patch: Partial<typeof draft>) => setForm({ ...draft, ...patch });
  const provider = PROVIDERS.find((p) => p.key === draft.provider);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform-ai'] });

  const save = useMutation({
    mutationFn: () =>
      apiFetch<AiSettings>('/platform/ai-settings', {
        method: 'PUT',
        body: {
          provider: draft.provider,
          endpoint: draft.provider === 'azure' ? draft.endpoint.trim() : null,
          model: draft.provider === 'anthropic' && draft.model.trim() ? draft.model.trim() : null,
          // Absent key = keep the stored one; only send what was typed.
          ...(draft.apiKey !== '' || !current?.hasKey ? { apiKey: draft.apiKey } : {}),
        },
      }),
    onSuccess: () => {
      toast.success('AI provider saved — effective on the next extraction');
      setForm(null);
      void refresh();
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save'),
  });

  const test = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; provider: string; detail: string }>('/platform/ai-settings/test', {
        method: 'POST',
        body: {},
      }),
    onSuccess: (r) => (r.ok ? toast.success(r.detail) : toast.error(r.detail)),
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Test failed'),
  });

  const clear = useMutation({
    mutationFn: () => apiFetch('/platform/ai-settings', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('AI settings removed — extraction falls back to the server default');
      setForm(null);
      void refresh();
    },
    onError: () => toast.error('Could not remove'),
  });

  if (settings.isPending) return <Skeleton className="mx-auto h-72 max-w-2xl" />;
  if (settings.isError) {
    const forbidden = settings.error instanceof ApiError && settings.error.status === 403;
    return (
      <ErrorState
        title={forbidden ? 'Operators only' : 'Could not load AI settings'}
        detail={
          forbidden
            ? 'This console is limited to platform administrators.'
            : (settings.error as Error).message
        }
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header className="flex items-start gap-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand)] text-white shadow-sm">
          <Sparkles aria-hidden="true" className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI provider</h1>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            The engine behind invoice extraction. Which features use it — and whether AI is enabled
            at all — stays under{' '}
            <Link href="/settings/ai" className="font-medium text-[var(--color-brand)]">
              AI settings
            </Link>
            .
          </p>
        </div>
      </header>

      <Card className="grid gap-4 p-5">
        <p className="flex items-center gap-2 text-sm">
          <span>
            Currently extracting with:{' '}
            <span className="font-semibold">{current?.effective.provider}</span>
            <span className="text-[var(--color-content-subtle)]">
              {' '}
              · {current?.effective.source === 'operator' ? 'set here' : 'server default'}
            </span>
          </span>
        </p>

        <Field label="Provider" htmlFor="aip">
          <select
            id="aip"
            value={draft.provider}
            onChange={(e) => set({ provider: e.target.value })}
            className={selectCls}
          >
            {PROVIDERS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {draft.provider === 'azure' ? (
          <Field label="Endpoint" htmlFor="aie">
            <Input
              id="aie"
              value={draft.endpoint}
              onChange={(e) => set({ endpoint: e.target.value })}
              placeholder="https://your-resource.cognitiveservices.azure.com"
            />
          </Field>
        ) : null}

        {draft.provider !== 'mock' ? (
          <div>
            <Field
              label={current?.hasKey ? 'API key' : 'API key'}
              htmlFor="aik"
            >
              <PasswordInput
                id="aik"
                autoComplete="off"
                value={draft.apiKey}
                onChange={(e) => set({ apiKey: e.target.value })}
                placeholder={current?.hasKey ? 'Stored — leave blank to keep it' : 'Paste the API key'}
              />
            </Field>
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              Encrypted before it is stored, and never sent back to this page.
            </p>
          </div>
        ) : null}

        {draft.provider === 'anthropic' ? (
          <Field label="Model (optional)" htmlFor="aim">
            <Input
              id="aim"
              value={draft.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder="Leave blank for the server default"
            />
          </Field>
        ) : null}

        {provider ? (
          <p className="rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2.5 text-xs text-[var(--color-content-muted)]">
            {provider.hint}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            Save settings
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={test.isPending}
            disabled={!current?.configured}
            onClick={() => test.mutate()}
          >
            <PlugZap aria-hidden="true" className="mr-1 size-3.5" /> Verify credentials
          </Button>
          {current?.configured ? (
            <Button
              size="sm"
              variant="danger"
              loading={clear.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Remove AI settings?',
                  body: 'Extraction goes back to the server default — on this deployment that means simulated results.',
                  confirmLabel: 'Remove',
                  destructive: true,
                });
                if (ok) clear.mutate();
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </Card>

      <p className="text-xs text-[var(--color-content-subtle)]">
        Whatever the provider, spec section 9 holds: AI only ever <em>proposes</em> — every financial
        figure is checked deterministically, and a person confirms before anything is final.
      </p>
    </div>
  );
}
