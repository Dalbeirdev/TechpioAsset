'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, PackageCheck, ShoppingCart } from 'lucide-react';
import type { RequestAssessment } from '@techpioasset/contracts';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, Field, NativeSelect } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * The commercial side of a request (v2.25).
 *
 * The employee stated a requirement; this is where somebody authorised states
 * the price. It is rendered only for holders of `requests:assess`, and the
 * server refuses the endpoint to anyone else - the requester must not be able
 * to see, let alone set, the number that decides whether Finance reviews their
 * own request.
 *
 * The total is deliberately not an input. It is computed here for immediate
 * feedback and computed again on the server, which is the copy that counts;
 * showing a field somebody could type into would invite the two to disagree.
 */

const money = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function ProcurementAssessment({ requestId }: { requestId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const assessment = useQuery({
    queryKey: ['assessment', requestId],
    queryFn: () => apiFetch<RequestAssessment | null>(`/requests/${requestId}/assessment`),
  });

  const [purchaseRequired, setPurchaseRequired] = useState<boolean | null>(null);
  /**
   * Which unit off the shelf fills this (v2.26).
   *
   * The stage asks "is it on the shelf?" and the answer used to be an
   * unverifiable yes: the record said something was in stock without saying
   * what, so nobody could check it, reserve it, or hand it over. The field has
   * been on the assessment since v2.25 with no screen to set it.
   */
  const [suitableAssetId, setSuitableAssetId] = useState<string>('');
  const [form, setForm] = useState({
    suggestedProduct: '',
    unitPrice: '',
    quantity: '1',
    taxAmount: '',
    shipping: '',
    discount: '',
    notes: '',
  });

  // Load the saved answer once it arrives, without stamping over an edit in
  // progress: the panel is often open while somebody is still typing.
  const loaded = assessment.data;
  useEffect(() => {
    if (!loaded) return;
    setPurchaseRequired(loaded.purchaseRequired);
    setSuitableAssetId(loaded.suitableAsset?.id ?? '');
    setForm({
      suggestedProduct: loaded.suggestedProduct ?? '',
      unitPrice: loaded.unitPrice ?? '',
      quantity: loaded.quantity != null ? String(loaded.quantity) : '1',
      taxAmount: loaded.taxAmount ?? '',
      shipping: loaded.shipping ?? '',
      discount: loaded.discount ?? '',
      notes: loaded.notes ?? '',
    });
    // Keyed to the saved answer, not to `loaded` itself: re-running on every
    // render would overwrite what somebody is part-way through typing.
  }, [loaded?.id, loaded?.assessedAt]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<RequestAssessment>(`/requests/${requestId}/assessment`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['assessment', requestId] });
      // The assessment can change which steps apply, so the chain is re-read too.
      await queryClient.invalidateQueries({ queryKey: ['request', requestId] });
      toast.success(
        saved.purchaseRequired === false
          ? 'Recorded — filled from stock, so no finance approval is needed'
          : 'Assessment saved',
      );
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save',
      ),
  });

  // Mirrors the server's arithmetic so the number moves as you type.
  const preview =
    form.unitPrice.trim() === ''
      ? null
      : Math.max(
          0,
          money(form.unitPrice) * Math.max(1, Number(form.quantity) || 1) +
            money(form.taxAmount) +
            money(form.shipping) -
            money(form.discount),
        );

  // Only what is genuinely on the shelf: AVAILABLE means received, unassigned
  // and not reserved for something else.
  const available = useQuery({
    queryKey: ['available-stock'],
    enabled: purchaseRequired === false,
    queryFn: () =>
      apiFetchPage<{ id: string; assetTag: string; name: string }>(
        '/assets?status=AVAILABLE&pageSize=100&sort=assetTag&order=asc',
      ).then((r) => r.data),
    staleTime: 30_000,
  });

  if (assessment.isPending) return null;

  const submit = () => {
    if (purchaseRequired === false) {
      save.mutate({
        inventoryAvailable: true,
        purchaseRequired: false,
        suitableAssetId: suitableAssetId || null,
        notes: form.notes || null,
      });
      return;
    }
    save.mutate({
      inventoryAvailable: false,
      purchaseRequired: true,
      suitableAssetId: null,
      suggestedProduct: form.suggestedProduct || null,
      unitPrice: form.unitPrice.trim() || null,
      quantity: Number(form.quantity) || 1,
      taxAmount: form.taxAmount.trim() || null,
      shipping: form.shipping.trim() || null,
      discount: form.discount.trim() || null,
      notes: form.notes || null,
    });
  };

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Calculator aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
        Procurement assessment
      </h2>
      <p className="mt-1 text-xs text-[var(--color-content-muted)]">
        The requester states what they need; the cost is recorded here. This figure is what decides
        whether finance approval is required — the requester never sees or sets it.
      </p>

      <fieldset className="mt-4">
        {/* v2.26 - ask the question the person is answering.
            "Is a purchase required?" put a No against the stock check in a
            reader's head: somebody checking the shelf thinks "available? no",
            clicks the No, and files "filled from existing stock". It happened -
            a replacement closed itself as fulfilled, Finance skipped, with
            "sorry not available in my stock" typed in the notes beside it. The
            stock question is the one being answered, so it is the one asked;
            the purchase follows from it and is spelled out underneath. */}
        <legend className="text-xs font-medium text-[var(--color-content-muted)]">
          Is this available in stock?
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          <ChoiceButton
            active={purchaseRequired === false}
            onClick={() => setPurchaseRequired(false)}
            icon={<PackageCheck aria-hidden="true" className="size-3.5" />}
            label="Yes — fill from stock"
          />
          <ChoiceButton
            active={purchaseRequired === true}
            onClick={() => setPurchaseRequired(true)}
            icon={<ShoppingCart aria-hidden="true" className="size-3.5" />}
            label="No — it must be bought"
          />
        </div>
      </fieldset>

      {purchaseRequired !== null ? (
        <p
          className="mt-2 text-xs"
          style={{
            color:
              purchaseRequired === false ? 'var(--tone-warning-fg)' : 'var(--color-content-muted)',
          }}
        >
          {purchaseRequired === false
            ? 'This closes the request as fulfilled — nothing is bought, and Finance will not review it.'
            : 'This sends it on to be costed, and to Finance if it clears the threshold.'}
        </p>
      ) : null}

      {/* v2.26 - "fill from stock" now says WHICH unit. Optional, because the
          shelf answer is still useful without it, but recorded when given so
          the next person can find the thing that was promised. */}
      {purchaseRequired === false ? (
        <div className="mt-4">
          <Field
            label="Which item?"
            htmlFor="pa-suitable"
            hint={
              available.isPending
                ? 'Looking for available stock…'
                : (available.data?.length ?? 0) === 0
                  ? 'Nothing is showing as available right now — you can still record the answer.'
                  : 'Optional. Naming it lets the next person find what was promised.'
            }
          >
            <NativeSelect
              id="pa-suitable"
              className="w-full"
              value={suitableAssetId}
              onChange={(e) => setSuitableAssetId(e.target.value)}
            >
              <option value="">Not specified</option>
              {(available.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.assetTag} · {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      ) : null}

      {purchaseRequired === true ? (
        <div className="mt-4 grid gap-3">
          <Field label="Product / model" htmlFor="pa-product">
            <Input
              id="pa-product"
              value={form.suggestedProduct}
              placeholder="Dell Latitude 7450"
              onChange={(e) => setForm({ ...form, suggestedProduct: e.target.value })}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Unit price" htmlFor="pa-unit">
              <Input
                id="pa-unit"
                inputMode="decimal"
                value={form.unitPrice}
                onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
              />
            </Field>
            <Field label="Quantity" htmlFor="pa-qty">
              <Input
                id="pa-qty"
                inputMode="numeric"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />
            </Field>
            <Field label="Tax" htmlFor="pa-tax">
              <Input
                id="pa-tax"
                inputMode="decimal"
                value={form.taxAmount}
                onChange={(e) => setForm({ ...form, taxAmount: e.target.value })}
              />
            </Field>
            <Field label="Shipping" htmlFor="pa-ship">
              <Input
                id="pa-ship"
                inputMode="decimal"
                value={form.shipping}
                onChange={(e) => setForm({ ...form, shipping: e.target.value })}
              />
            </Field>
            <Field label="Discount" htmlFor="pa-disc">
              <Input
                id="pa-disc"
                inputMode="decimal"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
              />
            </Field>
          </div>

          {preview !== null ? (
            <p className="flex items-baseline justify-between rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2">
              <span className="text-xs font-medium text-[var(--color-content-muted)]">
                Total estimated purchase
              </span>
              <span className="text-base font-semibold tabular-nums">
                {preview.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      {purchaseRequired !== null ? (
        <div className="mt-3 grid gap-3">
          <Field label="Notes" htmlFor="pa-notes">
            <textarea
              id="pa-notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2.5 text-sm"
            />
          </Field>
          <Button
            size="sm"
            className="justify-self-start"
            loading={save.isPending}
            onClick={submit}
          >
            Save assessment
          </Button>
        </div>
      ) : null}

      {assessment.data?.assessedBy ? (
        <p className="mt-4 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-content-subtle)]">
          {assessment.data.totalCost
            ? `Assessed at ${assessment.data.totalCost}`
            : 'Recorded as filled from stock'}{' '}
          by {assessment.data.assessedBy.name}
          {assessment.data.assessedAt
            ? ` on ${new Date(assessment.data.assessedAt).toLocaleDateString()}`
            : ''}
          .
        </p>
      ) : null}
    </Card>
  );
}

function ChoiceButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand)] px-3 py-1.5 text-xs font-semibold text-[var(--color-brand-contrast)]'
          : 'inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]'
      }
    >
      {icon}
      {label}
    </button>
  );
}
