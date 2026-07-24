'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ASSET_STATUSES, ASSET_CONDITIONS } from '@techpioasset/domain';
import { ASSET_STATUS_TOKENS, CONDITION_TOKENS } from '@techpioasset/ui-tokens';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
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
interface AssetDetail {
  id: string;
  assetTag: string;
  name: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: string;
  condition: string;
  purchaseDate: string | null;
  warrantyEndDate: string | null;
  version: number;
  category: { id: string; name: string } | null;
  subcategory: { id: string; name: string } | null;
  office: { id: string; name: string } | null;
}

const editSchema = z.object({
  name: z.string().min(1, 'Give the asset a name'),
  assetTag: z.string().min(1, 'Required'),
  categoryId: z.string().min(1, 'Choose a category'),
  subcategoryId: z.string().optional(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  officeId: z.string().optional(),
  purchaseDate: z.string().optional(),
  warrantyEndDate: z.string().optional(),
  condition: z.string().min(1),
  status: z.string().min(1),
});
type EditValues = z.infer<typeof editSchema>;

const toDateInput = (value: string | null): string => (value ? value.slice(0, 10) : '');

/**
 * The actual form. It only mounts once the asset, categories and offices are all
 * loaded, and initialises with defaultValues — so every Select's options and its
 * selected value appear together (resetting a Select before its options exist
 * leaves it showing the placeholder).
 */
function EditAssetForm({
  id,
  asset,
  categories,
  offices,
}: {
  id: string;
  asset: AssetDetail;
  categories: Category[];
  offices: Office[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: asset.name,
      assetTag: asset.assetTag,
      categoryId: asset.category?.id ?? '',
      subcategoryId: asset.subcategory?.id ?? '',
      brand: asset.brand ?? '',
      model: asset.model ?? '',
      serialNumber: asset.serialNumber ?? '',
      officeId: asset.office?.id ?? '',
      purchaseDate: toDateInput(asset.purchaseDate),
      warrantyEndDate: toDateInput(asset.warrantyEndDate),
      condition: asset.condition,
      status: asset.status,
    },
  });

  const selectedCategory = categories.find((c) => c.id === form.watch('categoryId'));

  const save = useMutation({
    mutationFn: async (values: EditValues) => {
      return apiFetch<{ id: string }>(`/assets/${id}`, {
        method: 'PATCH',
        body: {
          name: values.name,
          assetTag: values.assetTag,
          categoryId: values.categoryId,
          subcategoryId: values.subcategoryId || null,
          brand: values.brand || null,
          model: values.model || null,
          serialNumber: values.serialNumber || null,
          officeId: values.officeId || null,
          purchaseDate: values.purchaseDate || null,
          warrantyEndDate: values.warrantyEndDate || null,
          condition: values.condition,
          status: values.status,
          version: asset.version,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['asset', id] });
      toast.success('Asset updated');
      router.push(`/assets/${id}`);
    },
    onError: (caught) => {
      if (caught instanceof ApiError) {
        for (const [path, message] of Object.entries(caught.fieldErrors)) {
          form.setError(path as keyof EditValues, { message });
        }
        form.setError('root', {
          message:
            caught.problem.status === 409
              ? 'Someone else changed this asset while you were editing. Reload and try again.'
              : (caught.problem.detail ?? caught.problem.title),
        });
      } else {
        form.setError('root', { message: 'Could not save the asset.' });
      }
    },
  });

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Edit asset</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {asset.assetTag} · {asset.name}. The price is managed separately and is not editable here.
        </p>
      </header>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-4" noValidate>
          <Card className="grid gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset name</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                      <Input {...field} />
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
                        {categories.map((c) => (
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
                      <Input {...field} />
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
                      <Input {...field} />
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
                      <Input {...field} />
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
                        {offices.map((o) => (
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
                        {ASSET_CONDITIONS.map((c) => (
                          <SelectItem key={c} value={c}>
                            {CONDITION_TOKENS[c].label}
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
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ASSET_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {ASSET_STATUS_TOKENS[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
            <Button type="button" variant="secondary" onClick={() => router.push(`/assets/${id}`)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default function EditAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => apiFetch<AssetDetail>(`/assets/${id}`),
  });
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  });
  const officesQuery = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<Office[]>('/offices'),
  });

  if (assetQuery.isError) {
    return (
      <ErrorState title="Could not load the asset" detail={(assetQuery.error as Error).message} />
    );
  }
  // Wait for all three: the form initialises from them and must not mount early.
  if (!assetQuery.data || !categoriesQuery.data || !officesQuery.data) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <EditAssetForm
      id={id}
      asset={assetQuery.data}
      categories={categoriesQuery.data}
      offices={officesQuery.data}
    />
  );
}
