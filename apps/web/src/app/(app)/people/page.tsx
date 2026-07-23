'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetchPage } from '@/lib/api-client';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';

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

function PeopleTable() {
  const params = useSearchParams();
  const [page, setPage] = useState(1);
  const q = params.get('q') ?? '';

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (q) query.set('q', q);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['people', q, page],
    queryFn: () => apiFetchPage<UserRow>(`/users?${query.toString()}`),
  });

  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">People</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          {q ? `Results for “${q}”.` : 'Everyone you are permitted to see.'}
        </p>
      </header>

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
            description={q ? 'Try clearing the search.' : 'No one is visible to you yet.'}
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
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= data.meta.page.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

export default function PeoplePage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <PeopleTable />
    </Suspense>
  );
}
