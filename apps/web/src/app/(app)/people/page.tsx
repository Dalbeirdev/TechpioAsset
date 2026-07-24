'use client';

import { Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Settings2 } from 'lucide-react';
import { PERMISSIONS, SYSTEM_ROLES } from '@techpioasset/domain';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';

interface UserRow {
  id: string;
  email: string;
  status: string;
  profile: {
    firstName: string;
    lastName: string;
    department: { id: string; name: string } | null;
    office: { id: string; name: string } | null;
  } | null;
  roles: { role: { key: string; name: string } }[];
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DEACTIVATED: 'muted',
};

function statusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function roleLabel(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Modal to change a user's roles and account status. Admins only. */
function ManageUserModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { can, user: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canRoles = can(PERMISSIONS.ROLES_MANAGE);
  const canStatus = can(PERMISSIONS.USERS_MANAGE);
  const isSelf = me?.id === user.id;
  const name = user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.email;

  const [roleKeys, setRoleKeys] = useState<string[]>(user.roles.map((r) => r.role.key));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['people'] });
  };
  const onError = (caught: unknown) => {
    const message =
      caught instanceof ApiError
        ? (caught.problem.detail ?? caught.problem.title)
        : 'Something went wrong.';
    setError(message);
    toast.error(message);
  };

  const saveRoles = useMutation({
    mutationFn: () => apiFetch(`/users/${user.id}/roles`, { method: 'PATCH', body: { roleKeys } }),
    onSuccess: () => {
      setError(null);
      invalidate();
      toast.success(`${name}'s roles updated`);
      onClose();
    },
    onError,
  });

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/users/${user.id}/status`, { method: 'PATCH', body: { status } }),
    onSuccess: (_data, status) => {
      setError(null);
      invalidate();
      toast.success(status === 'ACTIVE' ? `${name} activated` : `${name} deactivated`);
      onClose();
    },
    onError,
  });

  // Deactivating removes someone's access — gate it behind an explicit confirm.
  const deactivate = async () => {
    const ok = await confirm({
      title: `Deactivate ${name}?`,
      body: 'They will lose access immediately and cannot sign in until reactivated. Their records and asset history are kept.',
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (ok) setStatus.mutate('DEACTIVATED');
  };

  const toggleRole = (key: string) =>
    setRoleKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const busy = saveRoles.isPending || setStatus.isPending;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Manage ${name}`}
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md p-5"
        // Stop backdrop clicks inside the card from closing the modal.
      >
        <div onClick={(e) => e.stopPropagation()}>
          <h2 className="text-[15px] font-semibold">Manage {name}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">{user.email}</p>

          {canRoles ? (
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Roles
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {SYSTEM_ROLES.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={roleKeys.includes(key)}
                      onChange={() => toggleRole(key)}
                      className="size-4 rounded border-[var(--color-border-strong)]"
                    />
                    {roleLabel(key)}
                  </label>
                ))}
              </div>
              <Button
                className="mt-3"
                size="sm"
                loading={saveRoles.isPending}
                disabled={roleKeys.length === 0 || busy}
                onClick={() => saveRoles.mutate()}
              >
                Save roles
              </Button>
            </fieldset>
          ) : null}

          {canStatus ? (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Account status
              </p>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">
                Currently <span className="font-medium">{statusLabel(user.status)}</span>.
              </p>
              {isSelf ? (
                <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
                  You cannot change your own account status.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {user.status !== 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setStatus.mutate('ACTIVE')}
                    >
                      Activate
                    </Button>
                  ) : null}
                  {user.status !== 'DEACTIVATED' ? (
                    <Button size="sm" variant="danger" disabled={busy} onClick={deactivate}>
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-[var(--radius-control)] border px-3 py-2 text-sm"
              style={{
                color: 'var(--tone-critical-fg)',
                backgroundColor: 'var(--tone-critical-bg)',
                borderColor: 'var(--tone-critical-border)',
              }}
            >
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex justify-end">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PeopleTable() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.USERS_MANAGE) || can(PERMISSIONS.ROLES_MANAGE);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [managing, setManaging] = useState<UserRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (q) query.set('q', q);
  if (role) query.set('role', role);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['people', q, role, page],
    queryFn: () => apiFetchPage<UserRow>(`/users?${query.toString()}`),
  });

  const hasFilters = q !== '' || role !== '';

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {canManage
            ? 'Everyone you can see. Manage roles and access from here.'
            : 'Everyone you are permitted to see.'}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--color-content-subtle)]"
          />
          <Input
            type="search"
            aria-label="Search people"
            placeholder="Search by name, email or employee number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filter by role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 text-sm"
        >
          <option value="">All roles</option>
          {SYSTEM_ROLES.map((key) => (
            <option key={key} value={key}>
              {roleLabel(key)}
            </option>
          ))}
        </select>
        {hasFilters ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('');
              setQ('');
              setRole('');
              setPage(1);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      <Card>
        {isPending ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState title="Could not load people" detail={(error as Error).message} />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No people found"
            description={hasFilters ? 'Try clearing the filters.' : 'No one is visible to you yet.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                People, {data.meta.page.totalItems} in total, page {data.meta.page.page} of{' '}
                {data.meta.page.totalPages}
              </caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Department
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Status
                  </th>
                  {canManage ? (
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {data.data.map((person) => (
                  <tr key={person.id} className="hover:bg-[var(--color-surface-sunken)]">
                    <td className="px-4 py-2.5 font-medium">
                      {person.profile
                        ? `${person.profile.firstName} ${person.profile.lastName}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {person.email}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {person.roles.map((r) => r.role.name).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-content-muted)]">
                      {person.profile?.department?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          color: `var(--tone-${STATUS_TONE[person.status] ?? 'muted'}-fg)`,
                          backgroundColor: `var(--tone-${STATUS_TONE[person.status] ?? 'muted'}-bg)`,
                        }}
                      >
                        {statusLabel(person.status)}
                      </span>
                    </td>
                    {canManage ? (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setManaging(person)}
                          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
                        >
                          <Settings2 aria-hidden="true" className="size-3.5" />
                          Manage
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.meta.page.totalPages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <p className="text-[var(--color-content-subtle)]">
            Page {data.meta.page.page} of {data.meta.page.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}

      {managing ? <ManageUserModal user={managing} onClose={() => setManaging(null)} /> : null}
    </div>
  );
}

export default function PeoplePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <PeopleTable />
    </Suspense>
  );
}
