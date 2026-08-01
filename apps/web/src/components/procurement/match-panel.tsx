'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card } from '@/components/ui';

interface MatchResult {
  outcome: 'MATCHED' | 'QTY_MISMATCH' | 'PRICE_MISMATCH' | 'NO_RECEIPT' | 'NO_PO';
  details: { receivedValue: number; invoiceTotal: number; delta: number; tolerance: number };
  overriddenAt: string | null;
  overrideReason: string | null;
}

const OUTCOME_LABEL: Record<MatchResult['outcome'], string> = {
  MATCHED: 'Matched',
  QTY_MISMATCH: 'Quantity mismatch',
  PRICE_MISMATCH: 'Price mismatch',
  NO_RECEIPT: 'Nothing received yet',
  NO_PO: 'No purchase order',
};

/**
 * v2.4 P3/P5 — the three-way-match verdict for a PO-linked invoice. Appears
 * once a verdict exists (a blocked verification stores one); a mismatch can be
 * overridden by a holder of procurement:match:override, with a reason, audited.
 */
export function MatchPanel({
  invoiceId,
  canRun,
  canOverride,
}: {
  invoiceId: string;
  canRun: boolean;
  canOverride: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const { data: match } = useQuery({
    queryKey: ['invoice-match', invoiceId],
    queryFn: () => apiFetch<MatchResult | null>(`/procurement/match/${invoiceId}`),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['invoice-match', invoiceId] });

  const run = useMutation({
    mutationFn: () => apiFetch(`/procurement/match/${invoiceId}/run`, { method: 'POST' }),
    onSuccess: () => void refresh(),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not run the match'),
  });

  const override = useMutation({
    mutationFn: () =>
      apiFetch(`/procurement/match/${invoiceId}/override`, {
        method: 'POST',
        body: { reason: reason.trim() },
      }),
    onSuccess: () => {
      toast.success('Mismatch overridden — on the audit record');
      setReason('');
      void refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not override'),
  });

  if (!match) return null;

  const ok = match.outcome === 'MATCHED';
  const overridden = !!match.overriddenAt;
  const d = match.details;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {ok ? (
              <CheckCircle2 className="size-4" style={{ color: 'var(--tone-success-fg)' }} />
            ) : (
              <AlertTriangle className="size-4" style={{ color: 'var(--tone-critical-fg)' }} />
            )}
            Three-way match: {OUTCOME_LABEL[match.outcome]}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
            Invoice {d.invoiceTotal.toFixed(2)} vs received {d.receivedValue.toFixed(2)} · delta{' '}
            {d.delta.toFixed(2)} · tolerance {d.tolerance.toFixed(2)}
          </p>
        </div>
        {canRun ? (
          <Button variant="ghost" size="sm" loading={run.isPending} onClick={() => run.mutate()}>
            <RefreshCw className="size-3.5" /> Re-run
          </Button>
        ) : null}
      </div>

      {overridden ? (
        <p
          className="mt-3 rounded-lg p-2.5 text-xs"
          style={{ background: 'var(--tone-warning-bg)', color: 'var(--tone-warning-fg)' }}
        >
          Mismatch accepted with a reason: “{match.overrideReason}”. Recorded in the audit log.
        </p>
      ) : !ok && canOverride ? (
        <div className="mt-3 grid gap-2">
          <input
            aria-label="Override reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this acceptable? (min 10 chars — goes on the audit record)"
            className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2 text-sm"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="danger"
              loading={override.isPending}
              disabled={reason.trim().length < 10}
              onClick={() => override.mutate()}
            >
              Accept mismatch anyway
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
