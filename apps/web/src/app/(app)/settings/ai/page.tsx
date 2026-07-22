'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';

interface AiConfigResponse {
  config: {
    id: string;
    globallyEnabled: boolean;
    pausedAt: string | null;
    featureModes: Record<string, string>;
    confidenceThreshold: string;
    humanReviewRequired: boolean;
    automaticFinancialApproval: boolean;
    providerName: string;
  };
  availableFeatures: string[];
  availableModes: string[];
}

const FEATURE_LABELS: Record<string, string> = {
  INVOICE_OCR: 'Invoice OCR',
  INVOICE_FIELD_EXTRACTION: 'Invoice field extraction',
  LINE_ITEM_EXTRACTION: 'Line-item extraction',
  CATEGORY_SUGGESTION: 'Category suggestion',
  VENDOR_SUGGESTION: 'Vendor suggestion',
  INVOICE_TO_ASSET_MATCHING: 'Invoice-to-asset matching',
  DUPLICATE_WARNING: 'Duplicate warning',
  WARRANTY_EXTRACTION: 'Warranty extraction',
  DRAFT_ASSET_CREATION: 'Draft asset creation',
  AI_SUMMARIES: 'AI summaries',
  AI_ASSISTANT: 'AI assistant',
  SEMANTIC_SEARCH: 'Semantic search',
};

export default function AiSettingsPage() {
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [globallyEnabled, setGloballyEnabled] = useState<boolean | null>(null);
  const [humanReview, setHumanReview] = useState<boolean | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => apiFetch<AiConfigResponse>('/ai-config'),
  });

  useEffect(() => {
    if (data) {
      setGloballyEnabled(data.config.globallyEnabled);
      setHumanReview(data.config.humanReviewRequired);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch('/ai-config', {
        method: 'PATCH',
        body: {
          globallyEnabled,
          humanReviewRequired: humanReview,
          featureModes: { ...data?.config.featureModes, ...dirty },
        },
      }),
    onSuccess: async () => {
      setDirty({});
      await queryClient.invalidateQueries({ queryKey: ['ai-config'] });
    },
  });

  if (isPending) return <Skeleton className="h-96" />;
  if (isError)
    return <ErrorState title="Could not load AI settings" detail={(error as Error).message} />;

  const modeOf = (feature: string) =>
    dirty[feature] ?? data.config.featureModes[feature] ?? 'DISABLED';
  const hasChanges =
    Object.keys(dirty).length > 0 ||
    globallyEnabled !== data.config.globallyEnabled ||
    humanReview !== data.config.humanReviewRequired;

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">AI configuration</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Controls invoice extraction and other AI-assisted features for your whole company.
        </p>
      </header>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">AI globally enabled</h2>
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              When off, no document is ever sent to an AI provider. Uploads and manual entry keep
              working, and deterministic verification always runs.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={globallyEnabled ?? false}
            onClick={() => setGloballyEnabled((v) => !v)}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            style={{
              backgroundColor: globallyEnabled
                ? 'var(--color-brand)'
                : 'var(--color-border-strong)',
            }}
          >
            <span
              className="absolute top-0.5 size-5 rounded-full bg-white transition-transform"
              style={{
                transform: globallyEnabled ? 'translateX(1.375rem)' : 'translateX(0.125rem)',
              }}
            />
          </button>
        </div>

        <div className="mt-4 flex items-start justify-between gap-4 border-t border-[var(--color-border)] pt-4">
          <div>
            <h2 className="text-sm font-semibold">Require human review</h2>
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              AI never finalises an invoice — a person always confirms. This cannot be bypassed for
              financial approval.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={humanReview ?? true}
            onClick={() => setHumanReview((v) => !v)}
            className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            style={{
              backgroundColor: humanReview ? 'var(--color-brand)' : 'var(--color-border-strong)',
            }}
          >
            <span
              className="absolute top-0.5 size-5 rounded-full bg-white transition-transform"
              style={{ transform: humanReview ? 'translateX(1.375rem)' : 'translateX(0.125rem)' }}
            />
          </button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="size-4 text-[var(--color-content-subtle)]" />
          <h2 className="text-sm font-semibold">Feature modes</h2>
        </div>
        <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
          Provider: {data.config.providerName}
          {data.config.providerName === 'mock' ? ' — extraction results are simulated' : ''}
        </p>

        <div className="mt-4 grid gap-2">
          {data.availableFeatures.map((feature) => (
            <div
              key={feature}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2"
            >
              <span className="text-sm">{FEATURE_LABELS[feature] ?? feature}</span>
              <select
                aria-label={`Mode for ${FEATURE_LABELS[feature] ?? feature}`}
                value={modeOf(feature)}
                onChange={(e) => setDirty((d) => ({ ...d, [feature]: e.target.value }))}
                disabled={!globallyEnabled}
                className="h-8 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-xs disabled:opacity-50"
              >
                {data.availableModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode
                      .toLowerCase()
                      .replace(/_/g, ' ')
                      .replace(/^\w/, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button loading={save.isPending} disabled={!hasChanges} onClick={() => save.mutate()}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
