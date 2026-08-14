'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Pencil, Plus, Users } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';

/**
 * Department management (v2.21).
 *
 * Departments were the mirror image of offices before v2.11: the model existed,
 * the picker on a person read them, approval routing depended on them - and
 * nothing in the product could create one, so the dropdown said "No department"
 * for good. This is the missing write side.
 *
 * Deactivating rather than deleting: a department that ran for three years is
 * part of the audit trail of every request it approved, so it disappears from
 * pickers while the people and history stay intact.
 */

interface Department {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  officeId: string | null;
  costCentre: string | null;
  headId: string | null;
  isActive: boolean;
  _count?: { profiles: number };
}

interface Office {
  id: string;
  name: string;
}

interface Draft {
  code: string;
  name: string;
  officeId: string;
  costCentre: string;
}

const EMPTY: Draft = { code: '', name: '', officeId: '', costCentre: '' };

export default function DepartmentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = can(PERMISSIONS.SETTINGS_MANAGE);

  const departments = useQuery({
    queryKey: ['departments-manage'],
    queryFn: () => apiFetch<Department[]>('/departments/manage'),
    enabled: canManage,
  });
  const offices = useQuery({
    queryKey: ['offices'],
    queryFn: () => apiFetch<Office[]>('/offices'),
  });

  const done = (message: string) => {
    setDraft(null);
    setEditing(null);
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['departments-manage'] });
    void queryClient.invalidateQueries({ queryKey: ['departments'] });
    toast.success(message);
  };
  const failed = (caught: unknown) => {
    const message =
      caught instanceof ApiError ? (caught.problem.detail ?? caught.problem.title) : 'Something went wrong.';
    setError(message);
    toast.error(message);
  };

  const create = useMutation({
    mutationFn: (body: Draft) =>
      apiFetch('/departments', {
        method: 'POST',
        body: {
          code: body.code,
          name: body.name,
          ...(body.officeId ? { officeId: body.officeId } : {}),
          ...(body.costCentre ? { costCentre: body.costCentre } : {}),
        },
      }),
    onSuccess: () => done('Department created'),
    onError: failed,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Draft> & { isActive?: boolean } }) =>
      apiFetch(`/departments/${id}`, {
        method: 'PATCH',
        body: {
          ...(body.code !== undefined ? { code: body.code } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.officeId !== undefined ? { officeId: body.officeId || null } : {}),
          ...(body.costCentre !== undefined ? { costCentre: body.costCentre || null } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      }),
    onSuccess: () => done('Department updated'),
    onError: failed,
  });

  if (!canManage) {
    return <ErrorState title="No access" detail="Managing departments needs settings permission." />;
  }

  const rows = departments.data ?? [];

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Departments</h1>
          <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
            Used on a person&apos;s profile, for approval routing, and to group assets by team.
          </p>
        </div>
        <Button className="ml-auto" onClick={() => { setDraft(EMPTY); setEditing(null); setError(null); }}>
          <Plus aria-hidden="true" className="mr-1.5 size-4" />
          New department
        </Button>
      </div>

      {error ? <ErrorState title="Could not save" detail={error} /> : null}

      {draft ? (
        <Card className="p-5">
          <h2 className="text-base font-semibold">{editing ? 'Edit department' : 'New department'}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dept-code" className="text-sm font-medium">Code</label>
              <Input
                id="dept-code"
                className="mt-1.5"
                placeholder="ENG"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
              <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
                Short handle, unique per company. Stored uppercase.
              </p>
            </div>
            <div>
              <label htmlFor="dept-name" className="text-sm font-medium">Name</label>
              <Input
                id="dept-name"
                className="mt-1.5"
                placeholder="Engineering"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="dept-office" className="text-sm font-medium">Office</label>
              <select
                id="dept-office"
                className="mt-1.5 h-10 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 text-sm"
                value={draft.officeId}
                onChange={(e) => setDraft({ ...draft, officeId: e.target.value })}
              >
                <option value="">No office</option>
                {(offices.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dept-cc" className="text-sm font-medium">
                Cost centre <span className="font-normal text-[var(--color-content-subtle)]">(optional)</span>
              </label>
              <Input
                id="dept-cc"
                className="mt-1.5"
                placeholder="CC-1042"
                value={draft.costCentre}
                onChange={(e) => setDraft({ ...draft, costCentre: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              loading={create.isPending || update.isPending}
              disabled={!draft.code.trim() || !draft.name.trim()}
              onClick={() => (editing ? update.mutate({ id: editing, body: draft }) : create.mutate(draft))}
            >
              {editing ? 'Save changes' : 'Create department'}
            </Button>
            <Button variant="secondary" onClick={() => { setDraft(null); setEditing(null); setError(null); }}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="min-w-0 overflow-hidden">
        {departments.isPending ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No departments yet"
            description="Create the first one and it appears on every person's profile and in approval routing."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Departments, {rows.length} in total</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">Department</th>
                  <th scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">Code</th>
                  <th scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">People</th>
                  <th scope="col" className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">Status</th>
                  <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="grid size-8 flex-none place-items-center rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
                          <Network aria-hidden="true" className="size-4" />
                        </span>
                        <span className="font-medium">{d.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{d.code}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[var(--color-content-muted)]">
                        <Users aria-hidden="true" className="size-3.5" />
                        {d._count?.profiles ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {d.isActive ? (
                        <span className="text-[var(--tone-success-fg)]">Active</span>
                      ) : (
                        <span className="text-[var(--color-content-subtle)]">Inactive</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(d.id);
                            setError(null);
                            setDraft({
                              code: d.code,
                              name: d.name,
                              officeId: d.officeId ?? '',
                              costCentre: d.costCentre ?? '',
                            });
                          }}
                        >
                          <Pencil aria-hidden="true" className="mr-1.5 size-4" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={update.isPending}
                          onClick={() => update.mutate({ id: d.id, body: { isActive: !d.isActive } })}
                        >
                          {d.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
