'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Building2, ChevronRight, Clock, Pencil, ShieldCheck, UserRound } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, Skeleton } from '@/components/ui';

/**
 * Your own profile — now with an edit path for everything, each field owned by
 * the right person.
 *
 * Three classes of field, and the page says which is which instead of showing
 * identical dead text for all of them:
 *
 *  - **Yours** (name, phone, job title): edit in place, saved to
 *    `PATCH /users/me/profile`, audited.
 *  - **Your administrator's** (department, office): these feed the DEPARTMENT
 *    data scope — letting a user move their own department would let them pick
 *    whose assets they see. Admins edit them from People; everyone else sees
 *    who to ask instead of a dash that looks broken.
 *  - **Nobody's, from here** (roles, visibility scope): access is never edited
 *    on a profile page.
 *
 * The security card now links to a page that exists.
 */

const SCOPE_COPY: Record<string, string> = {
  ALL: 'Everything in the company',
  DEPARTMENT: 'Your department',
  DIRECT_REPORTS: 'You and your direct reports',
  OWN: 'Only what is assigned to you',
};

const inputCls =
  'h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

function EditableRow({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      {editing ? (
        <dd className="mt-1 flex items-center gap-2">
          <input
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className={inputCls}
          />
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(draft.trim());
                setEditing(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
          <Button variant="secondary" onClick={() => { setDraft(value); setEditing(false); }}>
            Cancel
          </Button>
        </dd>
      ) : (
        <dd className="mt-0.5 flex items-center gap-2 text-sm font-medium">
          <span>{value || <span className="text-[var(--color-content-subtle)]">Not set</span>}</span>
          <button
            type="button"
            aria-label={`Edit ${label.toLowerCase()}`}
            onClick={() => { setDraft(value); setEditing(true); }}
            className="rounded p-1 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
          >
            <Pencil aria-hidden="true" className="size-3.5" />
          </button>
        </dd>
      )}
    </div>
  );
}

function ReadOnlyRow({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value || '—'}</dd>
      {note ? <dd className="mt-0.5 text-xs text-[var(--color-content-subtle)]">{note}</dd> : null}
    </div>
  );
}

export default function ProfilePage() {
  const { user, can, refresh } = useAuth();
  const toast = useToast();

  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      apiFetch('/users/me/profile', { method: 'PATCH', body }),
    onSuccess: async () => {
      toast.success('Profile updated');
      await refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save'),
  });

  if (!user) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const saveField = (field: string) => async (value: string) => {
    await save.mutateAsync({ [field]: value === '' ? null : value });
  };

  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.email;
  const initials =
    [user.firstName, user.lastName]
      .filter(Boolean)
      .map((n) => n![0])
      .join('')
      .toUpperCase() || user.email[0]?.toUpperCase();
  const isPeopleManager = can(PERMISSIONS.USERS_MANAGE);

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
        <h2 className="mb-4 flex items-center gap-3 text-base font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)]/10">
            <UserRound aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
          </span>
          About you
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <EditableRow label="First name" value={user.firstName ?? ''} onSave={saveField('firstName')} />
          <EditableRow label="Last name" value={user.lastName ?? ''} onSave={saveField('lastName')} />
          <EditableRow label="Job title" value={user.jobTitle ?? ''} placeholder="e.g. IT Manager" onSave={saveField('jobTitle')} />
          <EditableRow label="Phone" value={user.phone ?? ''} placeholder="+91 …" onSave={saveField('phone')} />
          <ReadOnlyRow
            label="Email"
            value={user.email}
            note="Your sign-in — contact support to change it."
          />
        </dl>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-3 text-base font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)]/10">
            <Building2 aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
          </span>
          Your place in the company
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <ReadOnlyRow
            label="Department"
            value={user.departmentName}
            note={
              isPeopleManager ? (
                <Link href="/people" className="text-[var(--color-brand)]">Edit on the People page</Link>
              ) : (
                'Set by your administrator'
              )
            }
          />
          <ReadOnlyRow
            label="Office"
            value={user.officeName}
            note={
              isPeopleManager ? (
                <Link href="/people" className="text-[var(--color-brand)]">Edit on the People page</Link>
              ) : (
                'Set by your administrator'
              )
            }
          />
          <ReadOnlyRow
            label="Roles"
            value={user.roleNames.length ? user.roleNames.join(', ') : user.roles.join(', ')}
            note="Access is managed in Roles, never from a profile."
          />
          <ReadOnlyRow label="What you can see" value={SCOPE_COPY[user.scope] ?? user.scope} />
        </dl>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)]/10">
            <ShieldCheck aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
          </span>
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              Two-factor authentication
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={
                  user.mfaEnabled
                    ? { background: 'var(--tone-success-bg)', color: 'var(--tone-success-fg)' }
                    : { background: 'var(--tone-warning-bg)', color: 'var(--tone-warning-fg)' }
                }
              >
                {user.mfaEnabled ? 'Enabled' : 'Not enabled yet'}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-[var(--color-content-muted)]">
              Add an extra layer of security to protect your account.
            </p>
            {!user.mfaEnabled ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--color-content-subtle)]">
                <Clock aria-hidden="true" className="size-3.5" /> Estimated setup time: ~5 minutes
              </p>
            ) : null}
          </div>
        </div>
        <Link
          href="/settings/security"
          className="inline-flex h-9 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10"
        >
          Security settings <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      </Card>
    </div>
  );
}
