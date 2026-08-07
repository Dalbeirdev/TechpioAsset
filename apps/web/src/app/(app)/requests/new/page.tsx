'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarDays, FileText, Flag, Plus, Send, Tag, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button, Card } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
] as const;

/** Dot colours mirror the priority tones used across the app. */
const PRIORITIES = [
  { value: 'LOW', label: 'Low', dot: 'var(--color-content-subtle)' },
  { value: 'NORMAL', label: 'Normal', dot: 'var(--tone-success-fg)' },
  { value: 'HIGH', label: 'High', dot: 'var(--tone-warning-fg)' },
  { value: 'URGENT', label: 'Urgent', dot: 'var(--tone-critical-fg)' },
] as const;

const TIPS = [
  {
    Icon: FileText,
    title: 'Be clear & specific',
    body: 'Provide a detailed reason and item description.',
  },
  {
    Icon: CalendarDays,
    title: 'Set a realistic date',
    body: 'Choose a date for when you really need it.',
  },
  {
    Icon: Tag,
    title: 'Estimate cost',
    body: 'An accurate cost helps with faster finance approval.',
  },
  {
    Icon: Flag,
    title: 'Choose priority wisely',
    body: 'High-priority requests are reviewed on an urgent basis.',
  },
] as const;

const requestSchema = z.object({
  type: z.string().min(1, 'Choose a request type'),
  priority: z.string().min(1),
  businessReason: z.string().min(10, 'At least 10 characters — approvers read this first.'),
  requiredBy: z.string().optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1, 'Required'),
        quantity: z.coerce.number().int().min(1, 'Min 1'),
        estimatedCost: z.string().optional(),
        categoryId: z.string().optional(),
      }),
    )
    .min(1, 'Add at least one item'),
});
type RequestValues = z.infer<typeof requestSchema>;

export default function NewRequestPage() {
  const router = useRouter();

  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      type: 'ADDITIONAL_EQUIPMENT',
      priority: 'NORMAL',
      businessReason: '',
      requiredBy: '',
      items: [{ description: '', quantity: 1, estimatedCost: '', categoryId: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  const submit = useMutation({
    mutationFn: async (values: RequestValues) => {
      const created = await apiFetch<{ id: string }>('/requests', {
        method: 'POST',
        body: {
          type: values.type,
          priority: values.priority,
          businessReason: values.businessReason,
          ...(values.requiredBy ? { requiredBy: values.requiredBy } : {}),
          items: values.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            ...(item.estimatedCost ? { estimatedCost: item.estimatedCost } : {}),
            ...(item.categoryId ? { categoryId: item.categoryId } : {}),
          })),
        },
      });
      // Created as a draft first, then submitted, so a validation failure never
      // leaves a half-built request in an approval queue.
      await apiFetch(`/requests/${created.id}/submit`, { method: 'POST' });
      return created;
    },
    onSuccess: (created) => router.push(`/requests/${created.id}`),
    onError: (caught) => {
      // Surface server-side field errors on the matching RHF fields.
      if (caught instanceof ApiError) {
        for (const [path, message] of Object.entries(caught.fieldErrors)) {
          form.setError(path as keyof RequestValues, { message });
        }
        form.setError('root', {
          message: caught.problem.detail ?? caught.problem.title,
        });
      } else {
        form.setError('root', { message: 'Could not create the request.' });
      }
    },
  });

  const priorityDot = (value: string) => PRIORITIES.find((p) => p.value === value)?.dot;

  return (
    <div className="mx-auto max-w-6xl">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/requests" className="text-[var(--color-brand)]">
          Requests
        </Link>
        <span className="mx-1.5 text-[var(--color-content-subtle)]">/</span>
        <span className="text-[var(--color-content-muted)]">New Request</span>
      </nav>

      <header className="mt-4 flex items-start gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[var(--color-brand)]/10">
          <FileText aria-hidden="true" className="size-6 text-[var(--color-brand)]" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New Request</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Your request will be routed for approval automatically based on what you ask for and
            its cost.
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => submit.mutate(values))}
            className="grid content-start gap-4"
            noValidate
          >
            <Card className="grid gap-5 p-6">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      What do you need? <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TYPES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="businessReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Why do you need it?{' '}
                      <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="Provide a brief description of why you need this."
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      At least 10 characters. Approvers read this first.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Priority <span style={{ color: 'var(--tone-critical-fg)' }}>*</span>
                      </FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="size-2 rounded-full"
                                style={{ background: priorityDot(field.value) }}
                              />
                              <SelectValue />
                            </span>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {PRIORITIES.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span className="flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className="size-2 rounded-full"
                                  style={{ background: option.dot }}
                                />
                                {option.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requiredBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Needed by</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Card>

            <Card className="grid gap-4 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Items</h2>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="border-[var(--color-brand)] text-[var(--color-brand)]"
                  onClick={() =>
                    append({ description: '', quantity: 1, estimatedCost: '', categoryId: '' })
                  }
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  Add Item
                </Button>
              </div>

              <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)]">
                <div className="hidden grid-cols-[1fr_5rem_7rem_2.5rem] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs font-medium text-[var(--color-content-subtle)] sm:grid">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Est. cost</span>
                  <span className="sr-only">Remove</span>
                </div>

                {fields.map((item, index) => (
                  <fieldset
                    key={item.id}
                    className="grid items-start gap-3 border-b border-[var(--color-border)] px-3 py-3 last:border-0 sm:grid-cols-[1fr_5rem_7rem_2.5rem]"
                  >
                    <legend className="sr-only">Item {index + 1}</legend>

                    <FormField
                      control={form.control}
                      name={`items.${index}.description`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sm:sr-only">Description</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter item description" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`items.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sm:sr-only">Qty</FormLabel>
                          <FormControl>
                            <Input type="number" min={1} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`items.${index}.estimatedCost`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sm:sr-only">Est. cost</FormLabel>
                          <FormControl>
                            <Input inputMode="decimal" placeholder="0.00" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <button
                      type="button"
                      aria-label={`Remove item ${index + 1}`}
                      disabled={fields.length === 1}
                      onClick={() => remove(index)}
                      className="grid size-9 place-items-center justify-self-end rounded-[var(--radius-control)] disabled:opacity-40"
                      style={{
                        color: 'var(--tone-critical-fg)',
                        backgroundColor: 'var(--tone-critical-bg)',
                      }}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                  </fieldset>
                ))}
              </div>

              <p className="text-xs text-[var(--color-content-subtle)]">
                Estimated cost decides whether finance approval is needed.
              </p>
            </Card>

            {form.formState.errors.root ? (
              <p
                role="alert"
                className="rounded-[var(--radius-control)] border px-3 py-2 text-sm"
                style={{
                  color: 'var(--tone-critical-fg)',
                  backgroundColor: 'var(--tone-critical-bg)',
                  borderColor: 'var(--tone-critical-border)',
                }}
              >
                {form.formState.errors.root.message}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" loading={submit.isPending}>
                Submit for approval <Send aria-hidden="true" className="ml-1.5 size-4" />
              </Button>
            </div>
          </form>
        </Form>

        <aside className="content-start">
          <Card className="grid gap-5 p-5">
            <div className="grid place-items-center rounded-[var(--radius-card)] bg-[var(--color-brand)]/5 py-6">
              <span className="grid size-16 place-items-center rounded-2xl bg-[var(--color-brand)]/10">
                <Send aria-hidden="true" className="size-7 text-[var(--color-brand)]" />
              </span>
            </div>
            <h2 className="text-sm font-semibold">Tips for a smooth approval</h2>
            <ul className="grid gap-4">
              {TIPS.map(({ Icon, title, body }) => (
                <li key={title} className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--color-brand)]/10">
                    <Icon aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-content-subtle)]">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
