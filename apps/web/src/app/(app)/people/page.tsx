'use client';

import { Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Search, Settings2 } from 'lucide-react';
import { PERMISSIONS, SYSTEM_ROLES, findSodConflicts } from '@techpioasset/domain';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { useConfirm } from '@/providers/confirm-provider';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { downloadCsv } from '@/lib/download-csv';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';

interface UserRow {
  id: string;
  email: string;
  status: string;
  profile: {
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    employeeNumber: string | null;
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
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  // WS-G — the tenant's full role list (system + custom) with each role's
  // permission keys, so the picker offers custom roles and can compute live
  // SoD warnings over the union of the selection. Falls back to system roles
  // if the fetch fails so the modal never goes blank.
  const tenantRoles = useQuery({
    queryKey: ['roles'],
    enabled: canRoles,
    queryFn: () =>
      apiFetch<{ key: string; name: string; isSystem: boolean; permissions: string[] }[]>('/roles'),
    staleTime: 60_000,
  });
  const roleOptions =
    tenantRoles.data ??
    SYSTEM_ROLES.map((key) => ({ key, name: roleLabel(key), isSystem: true, permissions: [] }));
  const sodConflicts = findSodConflicts(
    roleOptions.filter((r) => roleKeys.includes(r.key)).flatMap((r) => r.permissions),
  );
  // Saving a conflicting combination requires an explicit acknowledgment
  // (RBAC-024); a changed conflict set is a new decision, so the tick resets.
  const [sodAcknowledged, setSodAcknowledged] = useState(false);
  const sodKey = sodConflicts.map((c) => c.id).join('|');
  useEffect(() => {
    setSodAcknowledged(false);
  }, [sodKey]);
  const sodBlocked = sodConflicts.length > 0 && !sodAcknowledged;

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

  // Details the admin may set (PATCH /users/:id/profile). Department and
  // office matter beyond cosmetics: department feeds the DEPARTMENT data
  // scope, which is exactly why users cannot set these on themselves.
  const [details, setDetails] = useState({
    firstName: user.profile?.firstName ?? '',
    lastName: user.profile?.lastName ?? '',
    jobTitle: user.profile?.jobTitle ?? '',
    employeeNumber: user.profile?.employeeNumber ?? '',
    departmentId: user.profile?.department?.id ?? '',
    officeId: user.profile?.office?.id ?? '',
  });
  const departments = useQuery({
    queryKey: ['departments'],
    enabled: canStatus,
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/departments'),
    staleTime: 60_000,
  });
  const offices = useQuery({
    queryKey: ['offices'],
    enabled: canStatus,
    queryFn: () => apiFetch<{ id: string; name: string }[]>('/offices'),
    staleTime: 60_000,
  });

  const saveDetails = useMutation({
    mutationFn: () =>
      apiFetch(`/users/${user.id}/profile`, {
        method: 'PATCH',
        body: {
          firstName: details.firstName.trim(),
          lastName: details.lastName.trim(),
          jobTitle: details.jobTitle.trim() || null,
          employeeNumber: details.employeeNumber.trim() || null,
          ...(details.departmentId ? { departmentId: details.departmentId } : {}),
          ...(details.officeId ? { officeId: details.officeId } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
      toast.success(`${name}'s details updated`);
    },
    onError,
  });

  // Soft delete: the account vanishes from lists and cannot sign in, but the
  // row - and with it every "who had that laptop when" answer - stays.
  const removeUser = useMutation({
    mutationFn: () => apiFetch(`/users/${user.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null);
      invalidate();
      toast.success(`${name} deleted — their asset history is retained`);
      onClose();
    },
    onError,
  });
  const deleteUser = async () => {
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: 'They disappear from People and can never sign in again. Their asset assignment history and audit trail are kept, so past laptop custody stays answerable. Refused if equipment is still assigned to them.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) removeUser.mutate();
  };

  const toggleRole = (key: string) =>
    setRoleKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const busy =
    saveRoles.isPending || setStatus.isPending || saveDetails.isPending || removeUser.isPending;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Manage ${name}`}
      onClick={onClose}
    >
      <Card
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto p-5"
        // Stop backdrop clicks inside the card from closing the modal.
      >
        <div ref={trapRef} onClick={(e) => e.stopPropagation()}>
          <h2 className="text-[15px] font-semibold">Manage {name}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-content-subtle)]">{user.email}</p>

          {canStatus ? (
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Details
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Input
                  aria-label="First name"
                  value={details.firstName}
                  onChange={(e) => setDetails((d) => ({ ...d, firstName: e.target.value }))}
                  placeholder="First name"
                />
                <Input
                  aria-label="Last name"
                  value={details.lastName}
                  onChange={(e) => setDetails((d) => ({ ...d, lastName: e.target.value }))}
                  placeholder="Last name"
                />
                <Input
                  aria-label="Job title"
                  value={details.jobTitle}
                  onChange={(e) => setDetails((d) => ({ ...d, jobTitle: e.target.value }))}
                  placeholder="Job title"
                />
                <Input
                  aria-label="Employee number"
                  value={details.employeeNumber}
                  onChange={(e) => setDetails((d) => ({ ...d, employeeNumber: e.target.value }))}
                  placeholder="Employee number"
                />
                <select
                  aria-label="Department"
                  value={details.departmentId}
                  onChange={(e) => setDetails((d) => ({ ...d, departmentId: e.target.value }))}
                  className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm"
                >
                  <option value="">No department</option>
                  {(departments.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Office"
                  value={details.officeId}
                  onChange={(e) => setDetails((d) => ({ ...d, officeId: e.target.value }))}
                  className="h-9 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm"
                >
                  <option value="">No office</option>
                  {(offices.data ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                className="mt-3"
                size="sm"
                loading={saveDetails.isPending}
                disabled={busy || !details.firstName.trim() || !details.lastName.trim()}
                onClick={() => saveDetails.mutate()}
              >
                Save details
              </Button>
            </fieldset>
          ) : null}

          {canRoles ? (
            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                Roles
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {roleOptions.map((r) => (
                  <label key={r.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={roleKeys.includes(r.key)}
                      onChange={() => toggleRole(r.key)}
                      className="size-4 rounded border-[var(--color-border-strong)]"
                    />
                    <span className="min-w-0 truncate">{r.name}</span>
                    {!r.isSystem ? (
                      <span className="rounded-full bg-[var(--color-brand)]/10 px-1.5 text-[10px] font-semibold text-[var(--color-brand)]">
                        custom
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
              {sodConflicts.length > 0 ? (
                <div
                  role="alert"
                  className="mt-3 rounded-[var(--radius-card)] border border-[var(--tone-warning-fg)]/30 bg-[var(--tone-warning-bg)] p-2.5"
                >
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--tone-warning-fg)]">
                    <AlertTriangle className="size-3.5" />
                    Segregation-of-duties warning
                  </p>
                  <ul className="mt-1.5 grid gap-1">
                    {sodConflicts.map((c) => (
                      <li key={c.id} className="text-[11.5px] leading-snug text-[var(--tone-warning-fg)]">
                        {c.reason}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 flex items-start gap-2 text-[11.5px] font-medium text-[var(--tone-warning-fg)]">
                    <input
                      type="checkbox"
                      checked={sodAcknowledged}
                      onChange={(e) => setSodAcknowledged(e.target.checked)}
                      className="mt-0.5 size-3.5 accent-[var(--tone-warning-fg)]"
                    />
                    I understand this combination conflicts, and I accept the risk.
                  </label>
                </div>
              ) : null}
              <Button
                className="mt-3"
                size="sm"
                loading={saveRoles.isPending}
                disabled={roleKeys.length === 0 || busy || sodBlocked}
                title={sodBlocked ? 'Acknowledge the segregation-of-duties warning first' : undefined}
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
                  <Button
                    size="sm"
                    variant="danger"
                    loading={removeUser.isPending}
                    disabled={busy}
                    onClick={deleteUser}
                  >
                    Delete
                  </Button>
                </div>
              )}
              {!isSelf ? (
                <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
                  Delete is a soft delete: the account vanishes and cannot sign in, but asset
                  assignment history and the audit trail are kept.
                </p>
              ) : null}
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
  const toast = useToast();
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
        <button
          type="button"
          onClick={async () => {
            const p = new URLSearchParams();
            if (q) p.set('q', q);
            if (role) p.set('role', role);
            const ok = await downloadCsv(
              `/users/export${p.toString() ? `?${p}` : ''}`,
              'people.csv',
            );
            if (ok) toast.success('Export downloaded');
            else toast.error('Could not export');
          }}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          <Download aria-hidden="true" className="size-4" />
          Export
        </button>
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
