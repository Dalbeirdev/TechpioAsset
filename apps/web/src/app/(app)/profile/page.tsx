'use client';

import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { Card, Skeleton } from '@/components/ui';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value || '—'}</dd>
    </div>
  );
}

const SCOPE_COPY: Record<string, string> = {
  ALL: 'Everything in the company',
  DEPARTMENT: 'Your department',
  DIRECT_REPORTS: 'You and your direct reports',
  OWN: 'Only what is assigned to you',
};

export default function ProfilePage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.email;
  const initials =
    [user.firstName, user.lastName]
      .filter(Boolean)
      .map((n) => n![0])
      .join('')
      .toUpperCase() || user.email[0]?.toUpperCase();

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header className="flex items-center gap-4">
        <div
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-[var(--color-brand)] text-lg font-semibold text-[var(--color-brand-contrast)]"
        >
          {initials}
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{fullName}</h1>
          <p className="text-sm text-[var(--color-content-muted)]">
            {user.jobTitle ? `${user.jobTitle} · ` : ''}
            {user.email}
          </p>
        </div>
      </header>

      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Row label="Email" value={user.email} />
          <Row label="Job title" value={user.jobTitle} />
          <Row label="Department" value={user.departmentName} />
          <Row label="Office" value={user.officeName} />
          <Row
            label="Roles"
            value={user.roleNames.length ? user.roleNames.join(', ') : user.roles.join(', ')}
          />
          <Row label="What you can see" value={SCOPE_COPY[user.scope] ?? user.scope} />
        </dl>
      </Card>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <ShieldCheck aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
          <div>
            <p className="text-sm font-medium">Two-factor authentication</p>
            <p className="text-xs text-[var(--color-content-subtle)]">
              {user.mfaEnabled ? 'Enabled on your account.' : 'Not enabled yet.'}
            </p>
          </div>
        </div>
        <Link
          href="/settings/security"
          className="inline-flex h-9 items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 text-sm font-medium hover:bg-[var(--color-surface-sunken)]"
        >
          Security settings
        </Link>
      </Card>
    </div>
  );
}
