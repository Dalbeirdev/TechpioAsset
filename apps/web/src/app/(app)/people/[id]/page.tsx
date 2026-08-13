'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Laptop, Mail, Phone, ShieldCheck, ShieldOff } from 'lucide-react';
import { ASSET_STATUS_TOKENS, REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import type { AssetStatus } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { StatusBadge } from '@/components/status-badge';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';

/**
 * A person's profile (v2.15) - the people-side counterpart of the asset
 * detail page. Everything the admin needs about one person in one place:
 * who they are, how their account stands, what they hold, what they asked
 * for. Management actions stay on the People list's Manage panel; this
 * page is for READING a person, so it renders for every role that may
 * read employees.
 */

interface PersonDetail {
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: string | null;
  mfaEnabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  profile: {
    firstName: string;
    lastName: string;
    displayName: string | null;
    jobTitle: string | null;
    phone: string | null;
    employeeNumber: string | null;
    hireDate: string | null;
    department: { id: string; name: string } | null;
    office: { id: string; name: string } | null;
    manager: { id: string; email: string } | null;
  } | null;
  roles: { role: { key: string; name: string } }[];
}

interface HeldAsset {
  id: string;
  assetTag: string;
  name: string;
  status: AssetStatus;
  serialNumber: string | null;
}

interface PersonRequest {
  id: string;
  requestNumber: string;
  type: string;
  status: string;
  createdAt: string;
}

const label = (v: string) => v.charAt(0) + v.slice(1).toLowerCase().replaceAll('_', ' ');
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');

function Row({ label: l, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{l}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const person = useQuery({
    queryKey: ['person', id],
    queryFn: () => apiFetch<PersonDetail>(`/users/${id}`),
  });
  const assets = useQuery({
    queryKey: ['person-assets', id],
    queryFn: () => apiFetchPage<HeldAsset>(`/assets?assignedUserId=${id}&pageSize=50`),
  });
  const requests = useQuery({
    queryKey: ['person-requests', id],
    queryFn: () => apiFetchPage<PersonRequest>(`/requests?requesterId=${id}&pageSize=10`),
  });

  if (person.isPending) return <Skeleton className="h-96" />;
  if (person.isError)
    return <ErrorState title="Could not load this person" detail={(person.error as Error).message} />;

  const p = person.data;
  const name = p.profile ? `${p.profile.firstName} ${p.profile.lastName}` : p.email;

  return (
    <div className="grid gap-4">
      <Breadcrumbs items={[{ label: 'People', href: '/people' }, { label: name }]} />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
            <span className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[11px] font-medium">
              {label(p.status)}
            </span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-content-muted)]">
            <span className="inline-flex items-center gap-1">
              <Mail aria-hidden="true" className="size-3.5" /> {p.email}
            </span>
            {p.profile?.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone aria-hidden="true" className="size-3.5" /> {p.profile.phone}
              </span>
            ) : null}
          </p>
        </div>
        <Link
          href={`/people?q=${encodeURIComponent(p.email)}&manage=1`}
          className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          Manage
        </Link>
      </header>

      <Card className="p-5">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          <Row label="Job title" value={p.profile?.jobTitle ?? '—'} />
          <Row label="Employee number" value={p.profile?.employeeNumber ?? '—'} />
          <Row
            label="Roles"
            value={p.roles.map((r) => r.role.name).join(', ') || '—'}
          />
          <Row label="Department" value={p.profile?.department?.name ?? '—'} />
          <Row label="Office" value={p.profile?.office?.name ?? '—'} />
          <Row label="Manager" value={p.profile?.manager?.email ?? '—'} />
          <Row label="Joined" value={fmtDate(p.createdAt)} />
          <Row label="Hire date" value={fmtDate(p.profile?.hireDate ?? null)} />
          <Row label="Last sign-in" value={fmtDate(p.lastLoginAt)} />
          <Row
            label="Two-factor"
            value={
              p.mfaEnabledAt ? (
                <span className="inline-flex items-center gap-1" style={{ color: 'var(--tone-success-fg)' }}>
                  <ShieldCheck aria-hidden="true" className="size-4" /> Enabled
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[var(--color-content-muted)]">
                  <ShieldOff aria-hidden="true" className="size-4" /> Off
                </span>
              )
            }
          />
          <Row label="Email verified" value={p.emailVerifiedAt ? fmtDate(p.emailVerifiedAt) : 'Not yet'} />
        </dl>
      </Card>

      <Card className="p-0">
        <div className="border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Laptop aria-hidden="true" className="size-4 text-[var(--color-content-subtle)]" />
            Equipment held
            {assets.data ? (
              <span className="font-normal text-[var(--color-content-subtle)]">
                {assets.data.data.length}
              </span>
            ) : null}
          </h2>
        </div>
        {assets.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : (assets.data?.data.length ?? 0) === 0 ? (
          <EmptyState title="Nothing assigned" description="No equipment is currently issued to this person." />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {assets.data!.data.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div className="min-w-0">
                  <Link href={`/assets/${a.id}`} className="text-sm font-medium hover:underline">
                    {a.name}
                  </Link>
                  <p className="text-xs text-[var(--color-content-subtle)]">
                    {a.assetTag}
                    {a.serialNumber ? ` · SN ${a.serialNumber}` : ''}
                  </p>
                </div>
                <StatusBadge token={ASSET_STATUS_TOKENS[a.status]} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-sm font-semibold">Recent requests</h2>
        </div>
        {requests.isPending ? (
          <div className="grid gap-2 p-4">
            <Skeleton className="h-9" />
          </div>
        ) : (requests.data?.data.length ?? 0) === 0 ? (
          <EmptyState title="No requests" description="This person has not raised any requests." />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {requests.data!.data.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div>
                  <Link href={`/requests/${r.id}`} className="text-sm font-medium hover:underline">
                    {r.requestNumber}
                  </Link>
                  <p className="text-xs text-[var(--color-content-subtle)]">
                    {label(r.type)} · {fmtDate(r.createdAt)}
                  </p>
                </div>
                <StatusBadge token={REQUEST_STATUS_TOKENS[r.status as keyof typeof REQUEST_STATUS_TOKENS]} size="sm" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
