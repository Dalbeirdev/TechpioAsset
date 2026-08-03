'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Tone } from '@/components/assets/discovery-tabs';

/**
 * v2.6 A5 — the operator's tenant console. Access is operator-designated
 * (PLATFORM_ADMIN_EMAILS); everyone else gets the honest 403 below. The
 * bootstrap password appears exactly once.
 */

interface TenantRow {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  baseCurrency: string;
  usage: { users: number; assets: number; licenses: number };
}

interface ProvisionResult {
  id: string;
  name: string;
  admin: { email: string; initialPassword: string };
}

export default function TenantsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [provisioned, setProvisioned] = useState<ProvisionResult | null>(null);

  const tenants = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => apiFetch<TenantRow[]>('/platform/tenants'),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
  const onError = (caught: unknown) =>
    toast.error(
      caught instanceof ApiError ? (caught.problem.detail ?? caught.problem.title) : 'The action failed.',
    );

  const create = useMutation({
    mutationFn: () =>
      apiFetch<ProvisionResult>('/platform/tenants', {
        method: 'POST',
        body: {
          name: name.trim(),
          adminEmail: adminEmail.trim(),
          adminFirstName: firstName.trim(),
          adminLastName: lastName.trim(),
        },
      }),
    onSuccess: (data) => {
      setProvisioned(data);
      setName('');
      setAdminEmail('');
      setFirstName('');
      setLastName('');
      void refresh();
    },
    onError,
  });

  const setActive = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      apiFetch(`/platform/tenants/${input.id}/active`, {
        method: 'PATCH',
        body: { isActive: input.isActive },
      }),
    onSuccess: () => void refresh(),
    onError,
  });

  if (tenants.isPending) return <Skeleton className="h-80" />;
  if (tenants.isError) {
    const forbidden = tenants.error instanceof ApiError && tenants.error.status === 403;
    return (
      <ErrorState
        title={forbidden ? 'Operator access required' : 'Could not load tenants'}
        detail={
          forbidden
            ? 'The platform plane is operator-designated (PLATFORM_ADMIN_EMAILS). Tenant roles - including Super Admin - do not open it.'
            : (tenants.error as Error).message
        }
      />
    );
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Tenants</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Every workspace on this installation. Suspension blocks all of a tenant's logins.
        </p>
      </header>

      <Card className="grid gap-3 p-5">
        <h2 className="text-sm font-semibold">Provision a tenant</h2>
        {provisioned ? (
          <div
            className="rounded-[var(--radius-control)] border px-3 py-2.5 text-sm"
            style={{
              color: 'var(--tone-warning-fg)',
              backgroundColor: 'var(--tone-warning-bg)',
              borderColor: 'var(--tone-warning-border)',
            }}
          >
            <p className="font-semibold">
              {provisioned.name} is ready. Bootstrap credentials — shown once, pass them on securely:
            </p>
            <code className="mt-1 block select-all text-xs">
              {provisioned.admin.email} / {provisioned.admin.initialPassword}
            </code>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" htmlFor="t-name">
            <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Rentals Ltd." />
          </Field>
          <Field label="Admin email" htmlFor="t-email">
            <Input id="t-email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="owner@acme.example" />
          </Field>
          <Field label="Admin first name" htmlFor="t-fn">
            <Input id="t-fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Admin last name" htmlFor="t-ln">
            <Input id="t-ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
        </div>
        <Button
          className="justify-self-start"
          size="sm"
          loading={create.isPending}
          disabled={!name.trim() || !adminEmail.trim() || !firstName.trim() || !lastName.trim()}
          onClick={() => create.mutate()}
        >
          Provision tenant
        </Button>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Tenants</caption>
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th scope="col" className="px-4 py-2.5 font-medium">Tenant</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Usage</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {tenants.data.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-[var(--color-content-subtle)]">
                      Since {new Date(row.createdAt).toLocaleDateString()} · {row.baseCurrency}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-content-muted)]">
                    {row.usage.users} users · {row.usage.assets} assets · {row.usage.licenses} licenses
                  </td>
                  <td className="px-4 py-2.5">
                    <Tone tone={row.isActive ? 'success' : 'critical'}>
                      {row.isActive ? 'active' : 'suspended'}
                    </Tone>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={setActive.isPending}
                      onClick={() => {
                        if (row.isActive) {
                          void confirm({
                            title: `Suspend ${row.name}?`,
                            body: 'Every user in this workspace is locked out until reactivation.',
                            destructive: true,
                          }).then((ok) => ok && setActive.mutate({ id: row.id, isActive: false }));
                        } else {
                          setActive.mutate({ id: row.id, isActive: true });
                        }
                      }}
                    >
                      {row.isActive ? 'Suspend' : 'Reactivate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
