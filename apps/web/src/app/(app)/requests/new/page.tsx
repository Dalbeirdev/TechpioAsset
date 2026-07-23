'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2, Plus } from 'lucide-react';
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

interface Category {
  id: string;
  key: string;
  name: string;
  subcategories: { id: string; name: string }[];
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
] as const;

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

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

  // Loaded for the "estimated cost drives approval" hint and future category
  // selection; the query stays even though the field array is the focus.
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });

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

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New request</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Your request is routed for approval automatically based on what you ask for and its cost.
        </p>
      </header>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => submit.mutate(values))}
          className="grid gap-4"
          noValidate
        >
          <Card className="grid gap-4 p-5">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What do you need?</FormLabel>
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
                  <FormLabel>Why do you need it?</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
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
                    <FormLabel>Priority</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRIORITIES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {value.charAt(0) + value.slice(1).toLowerCase()}
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

          <Card className="grid gap-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Items</h2>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  append({ description: '', quantity: 1, estimatedCost: '', categoryId: '' })
                }
              >
                <Plus aria-hidden="true" className="size-3.5" />
                Add item
              </Button>
            </div>

            {fields.map((item, index) => (
              <fieldset
                key={item.id}
                className="grid gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] p-3 sm:grid-cols-[1fr_5rem_7rem_auto]"
              >
                <legend className="sr-only">Item {index + 1}</legend>

                <FormField
                  control={form.control}
                  name={`items.${index}.description`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
                      <FormLabel>Qty</FormLabel>
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
                      <FormLabel>Est. cost</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove item ${index + 1}`}
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
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
              Submit for approval
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
