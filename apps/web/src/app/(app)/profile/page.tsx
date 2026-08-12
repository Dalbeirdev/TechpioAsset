'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { Building2, Check, ChevronRight, Clock, Globe, Pencil, ShieldCheck, UserRound, X } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiBaseUrl, getAccessToken, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { AuthAvatar } from '@/components/auth-avatar';
import { Card, Skeleton } from '@/components/ui';

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

  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  // Both modes render one row of the SAME height (h-9): the text swaps for an
  // input in place, and save/cancel are compact icon buttons on the same line.
  // The first version stacked an input above two full-size buttons, which grew
  // the grid cell and shoved every neighbouring field around - opening an
  // editor must never move the thing next to it.
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 flex h-9 min-w-0 items-center gap-1.5">
        {editing ? (
          <>
            <input
              aria-label={label}
              value={draft}
              autoFocus
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') cancel();
              }}
              placeholder={placeholder}
              className="h-8 w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm"
            />
            <button
              type="button"
              aria-label={`Save ${label.toLowerCase()}`}
              disabled={busy}
              onClick={() => void save()}
              className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-[var(--color-brand)] text-[var(--color-brand-contrast)] disabled:opacity-50"
            >
              <Check aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Cancel editing ${label.toLowerCase()}`}
              disabled={busy}
              onClick={cancel}
              className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-sunken)]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </>
        ) : (
          <>
            <span className="truncate text-sm font-medium">
              {value || <span className="text-[var(--color-content-subtle)]">Not set</span>}
            </span>
            <button
              type="button"
              aria-label={`Edit ${label.toLowerCase()}`}
              onClick={() => {
                setDraft(value);
                setEditing(true);
              }}
              className="rounded p-1 text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
          </>
        )}
      </dd>
    </div>
  );
}

function ReadOnlyRow({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5 flex h-9 items-center text-sm font-medium">{value || '—'}</dd>
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
  const isSettingsManager = can(PERMISSIONS.SETTINGS_MANAGE);

  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <header className="flex items-center gap-4">
        <AvatarField initials={initials ?? '?'} hasPhoto={Boolean(user.avatarUrl)} onChanged={refresh} />
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
              isPeopleManager || isSettingsManager ? (
                <span className="flex flex-wrap gap-x-3">
                  {isPeopleManager ? (
                    <Link href="/people" className="text-[var(--color-brand)]">Edit on the People page</Link>
                  ) : null}
                  {isSettingsManager ? (
                    <Link href="/settings/offices" className="text-[var(--color-brand)]">Manage offices</Link>
                  ) : null}
                </span>
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

      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-3 text-base font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)]/10">
            <Globe aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
          </span>
          Preferences
        </h2>
        <p className="mb-3 text-xs text-[var(--color-content-subtle)]">
          How dates and language appear for you. These are personal and change nothing about your
          access.
        </p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          <PreferenceSelect
            label="Language"
            value={user.locale ?? ''}
            options={[
              ['', 'System default'],
              ['en-US', 'English (US)'],
              ['en-GB', 'English (UK)'],
              ['en-IN', 'English (India)'],
              ['hi-IN', 'हिन्दी'],
            ]}
            onSave={saveField('locale')}
          />
          <PreferenceSelect
            label="Time zone"
            value={user.timezone ?? ''}
            options={[
              ['', 'System default'],
              ['Asia/Kolkata', 'India (IST)'],
              ['UTC', 'UTC'],
              ['America/New_York', 'US Eastern'],
              ['Europe/London', 'UK'],
              ['Asia/Dubai', 'Gulf (GST)'],
            ]}
            onSave={saveField('timezone')}
          />
          <PreferenceSelect
            label="Date format"
            value={user.dateFormat ?? ''}
            options={[
              ['', 'System default'],
              ['DD/MM/YYYY', 'DD/MM/YYYY'],
              ['MM/DD/YYYY', 'MM/DD/YYYY'],
              ['YYYY-MM-DD', 'YYYY-MM-DD'],
            ]}
            onSave={saveField('dateFormat')}
          />
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

/** A labelled dropdown that saves on change — used for personal preferences. */
function PreferenceSelect({
  label,
  value,
  options,
  onSave,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onSave: (value: string) => Promise<void>;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-content-subtle)]">{label}</dt>
      <dd className="mt-0.5">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => void onSave(e.target.value)}
          className="h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm"
        >
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </dd>
    </div>
  );
}


/**
 * Profile photo (v2.12) — upload, replace, remove. Served from the API rather
 * than a public URL: the object is private and streamed only to its owner, so
 * the <img> points at /users/me/avatar with a cache-busting stamp.
 */
function AvatarField({
  initials,
  hasPhoto,
  onChanged,
}: {
  initials: string;
  hasPhoto: boolean;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(() => Date.now());
  const [present, setPresent] = useState(hasPhoto);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${apiBaseUrl}/users/me/avatar`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body: form,
      });
      if (!res.ok) throw new ApiError(await res.json().catch(() => null), res.status);
      setPresent(true);
      setStamp(Date.now());
      toast.success('Photo updated');
      await onChanged();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError
          ? (caught.problem?.detail ?? caught.problem?.title ?? 'Could not upload that photo')
          : 'Could not upload that photo',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiFetch('/users/me/avatar', { method: 'DELETE' });
      setPresent(false);
      toast.success('Photo removed');
      await onChanged();
    } catch {
      toast.error('Could not remove the photo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {present ? (
        <AuthAvatar
          enabled
          version={stamp}
          alt="Your profile photo"
          className="size-14 rounded-full object-cover"
        >
          <div
            aria-hidden="true"
            className="grid size-14 place-items-center rounded-full bg-[var(--color-surface-sunken)]"
          />
        </AuthAvatar>
      ) : (
        <div
          aria-hidden="true"
          className="grid size-14 place-items-center rounded-full bg-[var(--color-brand)] text-lg font-semibold text-[var(--color-brand-contrast)]"
        >
          {initials}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label
          className={`cursor-pointer text-xs font-medium text-[var(--color-brand)] ${busy ? 'pointer-events-none opacity-60' : ''}`}
        >
          {present ? 'Change photo' : 'Add photo'}
          <input
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/heic"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
        </label>
        {present ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="text-left text-xs text-[var(--color-content-subtle)] hover:text-[var(--tone-critical-fg)]"
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
