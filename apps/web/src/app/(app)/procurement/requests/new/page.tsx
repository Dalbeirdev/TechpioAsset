'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, Field, Input } from '@/components/ui';
import { Textarea } from '@/components/ui/textarea';
import { inputCls } from '@/components/procurement/shared';

interface Line {
  description: string;
  quantity: number;
  estimatedUnitPrice: string;
}

export default function NewPurchaseRequestPage() {
  const toast = useToast();
  const router = useRouter();
  const [justification, setJustification] = useState('');
  // v2.9 C2 - optional: a company with no cost centres never sees this.
  const [costCentreId, setCostCentreId] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', quantity: 1, estimatedUnitPrice: '' }]);

  const costCentres = useQuery({
    queryKey: ['cost-centres'],
    queryFn: () => apiFetchPage<{ id: string; code: string; name: string }>('/cost-centres?pageSize=100&activeOnly=true'),
  });

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const estimate = lines.reduce(
    (sum, l) => sum + (l.estimatedUnitPrice ? Number(l.estimatedUnitPrice) * l.quantity : 0),
    0,
  );

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>('/procurement/requests', {
        method: 'POST',
        body: {
          justification: justification.trim(),
          ...(costCentreId ? { costCentreId } : {}),
          lines: lines
            .filter((l) => l.description.trim())
            .map((l) => ({
              description: l.description.trim(),
              quantity: l.quantity,
              estimatedUnitPrice: l.estimatedUnitPrice || null,
            })),
        },
      }),
    onSuccess: (pr) => {
      toast.success('Purchase request drafted');
      router.push(`/procurement/requests/${pr.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create the request'),
  });

  const valid = justification.trim().length >= 10 && lines.some((l) => l.description.trim().length >= 2);

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <header>
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
          Purchasing
        </span>
        <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
          <ShoppingCart className="size-6 text-[var(--color-brand)]" /> New purchase request
        </h1>
      </header>

      <Card className="grid gap-4 p-6">
        <Field label="Why is this needed?" htmlFor="pr-why">
          <Textarea
            id="pr-why"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="At least 10 characters — approvers read this first."
            maxLength={2000}
          />
        </Field>

        {(costCentres.data?.data.length ?? 0) > 0 ? (
          <Field label="Charge to" htmlFor="pr-cc">
            <select
              id="pr-cc"
              value={costCentreId}
              onChange={(e) => setCostCentreId(e.target.value)}
              className={inputCls}
            >
              <option value="">No cost centre</option>
              {(costCentres.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              Charging a cost centre holds this request&apos;s estimate against its budget when the
              request is approved — and needs an estimated price on every line.
            </p>
          </Field>
        ) : null}

        <div>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            Lines
          </p>
          <div className="grid gap-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_120px_36px] items-center gap-2">
                <Input
                  aria-label={`Line ${i + 1} description`}
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="What to buy"
                />
                <input
                  aria-label={`Line ${i + 1} quantity`}
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: Math.max(1, Number(e.target.value)) })}
                  className={inputCls}
                />
                <input
                  aria-label={`Line ${i + 1} unit price`}
                  inputMode="decimal"
                  value={l.estimatedUnitPrice}
                  onChange={(e) => setLine(i, { estimatedUnitPrice: e.target.value })}
                  placeholder="Unit price"
                  className={inputCls}
                />
                <button
                  type="button"
                  aria-label={`Remove line ${i + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  className="grid size-9 place-items-center rounded-[var(--radius-control)] text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-40"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setLines((prev) => [...prev, { description: '', quantity: 1, estimatedUnitPrice: '' }])}
          >
            <Plus className="size-3.5" /> Add line
          </Button>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
          <p className="text-sm text-[var(--color-content-muted)]">
            Estimate:{' '}
            <span className="font-semibold tabular-nums">
              {estimate > 0 ? estimate.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
            </span>
            <span className="ml-2 text-xs text-[var(--color-content-subtle)]">
              (at or above the Finance threshold, Finance must approve)
            </span>
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => router.push('/procurement')}>
              Cancel
            </Button>
            <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
              Create draft
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
