'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { useAuth } from '@/providers/auth-provider';
import { Button, Card } from '@/components/ui';
import { Input } from '@/components/ui/input';
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
  name: string;
  subcategories: { id: string; name: string }[];
}
interface Office {
  id: string;
  name: string;
}

const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR'] as const;

const assetSchema = z.object({
  name: z.string().min(1, 'Give the asset a name'),
  assetTag: z.string().min(1, 'Required — a short unique tag, e.g. AST-0201'),
  categoryId: z.string().min(1, 'Choose a category'),
  subcategoryId: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  officeId: z.string().optional(),
  purchaseDate: z.string().optional(),
  warrantyEndDate: z.string().optional(),
  condition: z.string().min(1),
  purchaseCost: z
    .string()
    .regex(/^\d*(\.\d{1,2})?$/, 'A plain amount, e.g. 45000 or 45000.50')
    .optional()
    .or(z.literal('')),
});
type AssetValues = z.infer<typeof assetSchema>;

export default function NewAssetPage() {
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  // Price is a Finance / Super Admin field; everyone else never sees it and
  // Finance records it once (it locks after saving).
  const canSetPrice = can(PERMISSIONS.ASSETS_COST_READ);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });
  const { data: offices } = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<Office[]>('/offices'),
  });

  const form = useForm<AssetValues>({
    resolver: zodResolver(assetSchema),
    defaultValues: {
      name: '',
      assetTag: '',
      categoryId: '',
      subcategoryId: '',
      brand: '',
      model: '',
      serialNumber: '',
      officeId: '',
      purchaseDate: '',
      warrantyEndDate: '',
      condition: 'GOOD',
      purchaseCost: '',
    },
  });

  const selectedCategory = categories?.find((c) => c.id === form.watch('categoryId'));

  const submit = useMutation({
    mutationFn: async (values: AssetValues) => {
      return apiFetch<{ id: string }>('/assets', {
        method: 'POST',
        body: {
          name: values.name,
          assetTag: values.assetTag,
          categoryId: values.categoryId,
          ...(values.subcategoryId ? { subcategoryId: values.subcategoryId } : {}),
          ...(values.brand ? { brand: values.brand } : {}),
          ...(values.model ? { model: values.model } : {}),
          ...(values.serialNumber ? { serialNumber: values.serialNumber } : {}),
          ...(values.officeId ? { officeId: values.officeId } : {}),
          ...(values.purchaseDate ? { purchaseDate: values.purchaseDate } : {}),
          ...(values.warrantyEndDate ? { warrantyEndDate: values.warrantyEndDate } : {}),
          condition: values.condition,
          status: 'AVAILABLE',
          ...(canSetPrice && values.purchaseCost ? { purchaseCost: values.purchaseCost } : {}),
        },
      });
    },
    onSuccess: (created) => {
      toast.success('Asset created');
      router.push(`/assets/${created.id}`);
    },
    onError: (caught) => {
      if (caught instanceof ApiError) {
        for (const [path, message] of Object.entries(caught.fieldErrors)) {
          form.setError(path as keyof AssetValues, { message });
        }
        form.setError('root', { message: caught.problem.detail ?? caught.problem.title });
      } else {
        form.setError('root', { message: 'Could not create the asset.' });
      }
    },
  });

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Add asset</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Register a single asset.{' '}
          {canSetPrice
            ? 'The price is recorded once and locks after saving.'
            : 'Finance records the price separately.'}
        </p>
      </header>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => submit.mutate(v))}
          className="grid gap-4"
          noValidate
        >
          <Card className="grid gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset name</FormLabel>
                    <FormControl>
                      <Input placeholder="Dell Latitude 5420" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assetTag"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset tag</FormLabel>
                    <FormControl>
                      <Input placeholder="AST-0201" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(categories ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
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
                name="subcategoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={field.onChange}
                      disabled={!selectedCategory?.subcategories.length}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="e.g. Laptop" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(selectedCategory?.subcategories ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl>
                      <Input placeholder="Dell" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl>
                      <Input placeholder="Latitude 5420" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serialNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serial number</FormLabel>
                    <FormControl>
                      <Input placeholder="C6081F3" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="officeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Office</FormLabel>
                    <Select value={field.value ?? ''} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Where it lives" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {(offices ?? []).map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            {o.name}
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
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchased on</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="warrantyEndDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warranty ends</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="condition"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Condition</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c.charAt(0) + c.slice(1).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {canSetPrice ? (
                <FormField
                  control={form.control}
                  name="purchaseCost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Price</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="45000.00" {...field} />
                      </FormControl>
                      <FormDescription>
                        Entered once — it locks after saving and cannot be edited.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </div>
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
              Create asset
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
