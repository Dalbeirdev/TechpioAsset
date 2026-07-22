'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2, Plus } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button, Card, Field, Input } from '@/components/ui';

interface Category {
  id: string;
  key: string;
  name: string;
  subcategories: { id: string; name: string }[];
}

interface ItemDraft {
  description: string;
  quantity: number;
  estimatedCost: string;
  categoryId: string;
}

const TYPES = [
  { value: 'ADDITIONAL_EQUIPMENT', label: 'Additional equipment' },
  { value: 'REPLACEMENT', label: 'Replacement' },
  { value: 'UPGRADE', label: 'Upgrade' },
  { value: 'DAMAGE', label: 'Damaged item' },
  { value: 'LOSS', label: 'Lost item' },
  { value: 'REPAIR', label: 'Repair' },
  { value: 'OFFICE_REQUIREMENT', label: 'Office / furniture' },
  { value: 'KITCHEN_REQUIREMENT', label: 'Kitchen / pantry' },
  { value: 'ACCESSIBILITY_REQUIREMENT', label: 'Accessibility' },
  { value: 'PROJECT_REQUIREMENT', label: 'Project requirement' },
];

export default function NewRequestPage() {
  const router = useRouter();

  const [type, setType] = useState('ADDITIONAL_EQUIPMENT');
  const [priority, setPriority] = useState('NORMAL');
  const [businessReason, setBusinessReason] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([
    { description: '', quantity: 1, estimatedCost: '', categoryId: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });

  const submit = useMutation({
    mutationFn: async (submitNow: boolean) => {
      const created = await apiFetch<{ id: string }>('/requests', {
        method: 'POST',
        body: {
          type,
          priority,
          businessReason,
          ...(requiredBy ? { requiredBy } : {}),
          items: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            ...(item.estimatedCost ? { estimatedCost: item.estimatedCost } : {}),
            ...(item.categoryId ? { categoryId: item.categoryId } : {}),
          })),
        },
      });

      // Created as a draft first, then submitted, so a validation failure never
      // leaves a half-built request in an approval queue.
      if (submitNow) {
        await apiFetch(`/requests/${created.id}/submit`, { method: 'POST' });
      }
      return created;
    },
    onSuccess: (created) => router.push(`/requests/${created.id}`),
    onError: (caught) => {
      if (caught instanceof ApiError) {
        setError(caught.problem.detail ?? caught.problem.title);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Could not create the request.');
      }
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    submit.mutate(true);
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New request</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Your request is routed for approval automatically based on what you ask for and its cost.
        </p>
      </header>

      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        <Card className="grid gap-4 p-5">
          <Field label="What do you need?" htmlFor="type">
            <select
              id="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Why do you need it?"
            htmlFor="businessReason"
            hint="At least 10 characters. Approvers read this first."
            error={fieldErrors.businessReason}
          >
            <textarea
              id="businessReason"
              rows={3}
              required
              value={businessReason}
              onChange={(e) => setBusinessReason(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 text-sm"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority" htmlFor="priority">
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 text-sm"
              >
                {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0) + value.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Needed by" htmlFor="requiredBy">
              <Input
                id="requiredBy"
                type="date"
                value={requiredBy}
                onChange={(e) => setRequiredBy(e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card className="grid gap-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Items</h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  { description: '', quantity: 1, estimatedCost: '', categoryId: '' },
                ])
              }
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Add item
            </Button>
          </div>

          {items.map((item, index) => (
            <fieldset
              key={index}
              className="grid gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] p-3 sm:grid-cols-[1fr_5rem_7rem_auto]"
            >
              <legend className="sr-only">Item {index + 1}</legend>

              <Field label="Description" htmlFor={`item-${index}-description`}>
                <Input
                  id={`item-${index}-description`}
                  required
                  value={item.description}
                  onChange={(e) =>
                    setItems((current) =>
                      current.map((it, i) =>
                        i === index ? { ...it, description: e.target.value } : it,
                      ),
                    )
                  }
                />
              </Field>

              <Field label="Qty" htmlFor={`item-${index}-quantity`}>
                <Input
                  id={`item-${index}-quantity`}
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) =>
                    setItems((current) =>
                      current.map((it, i) =>
                        i === index ? { ...it, quantity: Number(e.target.value) } : it,
                      ),
                    )
                  }
                />
              </Field>

              <Field label="Est. cost" htmlFor={`item-${index}-cost`}>
                <Input
                  id={`item-${index}-cost`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={item.estimatedCost}
                  onChange={(e) =>
                    setItems((current) =>
                      current.map((it, i) =>
                        i === index ? { ...it, estimatedCost: e.target.value } : it,
                      ),
                    )
                  }
                />
              </Field>

              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </fieldset>
          ))}

          {categories ? (
            <p className="text-xs text-[var(--color-content-subtle)]">
              Estimated cost decides whether finance approval is needed.
            </p>
          ) : null}
        </Card>

        {error ? (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
            style={{
              color: 'var(--tone-critical-fg)',
              backgroundColor: 'var(--tone-critical-bg)',
              borderColor: 'var(--tone-critical-border)',
            }}
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={submit.isPending}>
            Submit for approval
          </Button>
        </div>
      </form>
    </div>
  );
}
