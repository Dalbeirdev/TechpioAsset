'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, Lock, Pencil, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, EmptyState, ErrorState, Field, Input, Skeleton } from '@/components/ui';
import { Textarea } from '@/components/ui/textarea';
import { PERMISSIONS, findSodConflicts } from '@techpioasset/domain';

interface RoleListItem {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isReadOnly: boolean;
  permissionCount: number;
  userCount: number;
}
interface RoleDetail extends Omit<RoleListItem, 'permissionCount'> {
  permissions: string[];
}
interface Catalogue {
  resources: { resource: string; permissions: { key: string; action: string; readOnly: boolean }[] }[];
}
type Editor = { mode: 'new' } | { mode: 'edit'; id: string } | null;

const RESOURCE_LABELS: Record<string, string> = { ai: 'AI', qr: 'QR' };
const titleize = (s: string) =>
  RESOURCE_LABELS[s] ?? s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const actionLabel = (a: string) => a.replace(/[-:]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function RolesSettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editor, setEditor] = useState<Editor>(null);

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => apiFetch<RoleListItem[]>('/roles'),
  });
  const catalogue = useQuery({
    queryKey: ['role-permissions'],
    queryFn: () => apiFetch<Catalogue>('/roles/permissions'),
    staleTime: 5 * 60_000,
  });

  if (!can(PERMISSIONS.ROLES_MANAGE)) {
    return <ErrorState title="Not available" detail="You need the Manage roles permission to view this page." />;
  }

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
            Administration
          </span>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
            <ShieldCheck className="size-6 text-[var(--color-brand)]" /> Roles &amp; permissions
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Build custom roles from the permission catalogue. System roles are fixed; a read-only
            role can only ever hold read permissions.
          </p>
        </div>
        <Button onClick={() => setEditor({ mode: 'new' })}>
          <Plus className="size-4" /> New role
        </Button>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* List */}
        <section aria-label="Roles" className="grid gap-3 self-start">
          {roles.isPending ? (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-20" />)
          ) : roles.isError ? (
            <ErrorState title="Could not load roles" detail={errMsg(roles.error)} />
          ) : roles.data.length === 0 ? (
            <EmptyState title="No roles yet" description="Create your first custom role to get started." />
          ) : (
            roles.data.map((r) => (
              <RoleRow
                key={r.id}
                role={r}
                active={editor?.mode === 'edit' && editor.id === r.id}
                onEdit={() => setEditor({ mode: 'edit', id: r.id })}
              />
            ))
          )}
        </section>

        {/* Editor */}
        <section aria-label="Role editor" className="lg:sticky lg:top-20 self-start">
          {editor ? (
            <RoleEditor
              key={editor.mode === 'edit' ? editor.id : 'new'}
              editor={editor}
              catalogue={catalogue.data}
              onClose={() => setEditor(null)}
              onSaved={async () => {
                await qc.invalidateQueries({ queryKey: ['roles'] });
                setEditor(null);
              }}
              onDeleted={async () => {
                await qc.invalidateQueries({ queryKey: ['roles'] });
                setEditor(null);
                toast.success('Role deleted');
              }}
            />
          ) : (
            <Card className="p-8">
              <EmptyState
                title="Select a role"
                description="Pick a role to edit, or create a new one. System roles are read-only."
              />
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function RoleRow({
  role,
  active,
  onEdit,
}: {
  role: RoleListItem;
  active: boolean;
  onEdit: () => void;
}) {
  return (
    <Card className={`p-4 transition ${active ? 'ring-2 ring-[var(--color-brand)]' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{role.name}</span>
            {role.isSystem ? <Badge tone="neutral" icon={<Lock className="size-3" />}>System</Badge> : null}
            {role.isReadOnly ? <Badge tone="info">Read-only</Badge> : null}
          </div>
          {role.description ? (
            <p className="mt-1 line-clamp-2 text-[13px] text-[var(--color-content-muted)]">
              {role.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-content-subtle)]">
            <span className="inline-flex items-center gap-1">
              <KeyRound className="size-3.5" /> {role.permissionCount} permission
              {role.permissionCount === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" /> {role.userCount} member{role.userCount === 1 ? '' : 's'}
            </span>
            <span className="font-mono text-[11px] text-[var(--color-content-subtle)]">{role.key}</span>
          </div>
        </div>
        {role.isSystem ? (
          <span className="shrink-0 text-xs text-[var(--color-content-subtle)]">Fixed</span>
        ) : (
          <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${role.name}`}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        )}
      </div>
    </Card>
  );
}

function RoleEditor({
  editor,
  catalogue,
  onClose,
  onSaved,
  onDeleted,
}: {
  editor: Exclude<Editor, null>;
  catalogue: Catalogue | undefined;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const toast = useToast();
  const isNew = editor.mode === 'new';

  const detail = useQuery({
    queryKey: ['role', isNew ? 'new' : editor.id],
    enabled: !isNew,
    queryFn: () => apiFetch<RoleDetail>(`/roles/${(editor as { id: string }).id}`),
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sodAcknowledged, setSodAcknowledged] = useState(false);
  const loaded = detail.data;

  // Prefill from the loaded role once.
  useEffect(() => {
    if (loaded) {
      setName(loaded.name);
      setDescription(loaded.description ?? '');
      setReadOnly(loaded.isReadOnly);
      setPerms(new Set(loaded.permissions));
    }
  }, [loaded]);

  const readOnlyKeys = useMemo(() => {
    const set = new Set<string>();
    for (const g of catalogue?.resources ?? [])
      for (const p of g.permissions) if (p.readOnly) set.add(p.key);
    return set;
  }, [catalogue]);

  // Read-only roles may hold only read permissions: drop any writes when toggled on.
  function toggleReadOnly(on: boolean) {
    setReadOnly(on);
    if (on) setPerms((prev) => new Set([...prev].filter((k) => readOnlyKeys.has(k))));
  }
  function togglePerm(key: string) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleGroup(keys: string[], allOn: boolean) {
    setPerms((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allOn) next.delete(k);
        else if (!readOnly || readOnlyKeys.has(k)) next.add(k);
      }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        permissions: [...perms],
        ...(isNew ? { isReadOnly: readOnly } : {}),
      };
      return isNew
        ? apiFetch('/roles', { method: 'POST', body })
        : apiFetch(`/roles/${(editor as { id: string }).id}`, { method: 'PATCH', body });
    },
    onSuccess: async () => {
      toast.success(isNew ? 'Role created' : 'Role updated');
      await onSaved();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/roles/${(editor as { id: string }).id}`, { method: 'DELETE' }),
    onSuccess: async () => onDeleted(),
    onError: (e) => {
      toast.error(errMsg(e));
      setConfirmDelete(false);
    },
  });

  if (!isNew && detail.isPending) {
    return (
      <Card className="grid gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </Card>
    );
  }

  const nameError = save.error && name.trim().length < 2 ? 'Give the role a name' : undefined;
  const inUse = !isNew && (loaded?.userCount ?? 0) > 0;
  // Live segregation-of-duties check over the current selection. Combining
  // duties is allowed but must be an explicit choice: saving with conflicts
  // requires ticking the acknowledgment below (RBAC-024).
  const sodConflicts = findSodConflicts([...perms]);
  const sodKey = sodConflicts.map((c) => c.id).join('|');
  // A different conflict set is a different decision — re-require the tick.
  useEffect(() => {
    setSodAcknowledged(false);
  }, [sodKey]);
  const sodBlocked = sodConflicts.length > 0 && !sodAcknowledged;

  return (
    <Card className="grid gap-5 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">{isNew ? 'New role' : `Edit ${loaded?.name ?? 'role'}`}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close editor"
          className="grid size-8 place-items-center rounded-[var(--radius-control)] text-[var(--color-content-subtle)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-content)]"
        >
          <X className="size-4" />
        </button>
      </div>

      <Field label="Name" htmlFor="role-name" error={nameError}>
        <Input
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Warehouse Lead"
          maxLength={60}
        />
      </Field>

      <Field label="Description" htmlFor="role-desc">
        <Textarea
          id="role-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this role for?"
          maxLength={280}
        />
      </Field>

      {isNew ? (
        <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => toggleReadOnly(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span className="text-[13px]">
            <span className="font-semibold">Read-only role</span>
            <span className="block text-[var(--color-content-muted)]">
              Can only be granted read permissions — write permissions are disabled below.
            </span>
          </span>
        </label>
      ) : loaded?.isReadOnly ? (
        <Badge tone="info">Read-only role — only read permissions can be granted</Badge>
      ) : null}

      {/* Permission picker */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            Permissions
          </h3>
          <span className="text-xs text-[var(--color-content-subtle)] tabular-nums">
            {perms.size} selected
          </span>
        </div>
        {!catalogue ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid max-h-[46vh] gap-3 overflow-y-auto pr-1">
            {catalogue.resources.map((g) => {
              const keys = g.permissions.map((p) => p.key);
              const selectable = keys.filter((k) => !readOnly || readOnlyKeys.has(k));
              const allOn = selectable.length > 0 && selectable.every((k) => perms.has(k));
              return (
                <div
                  key={g.resource}
                  className="rounded-[var(--radius-card)] border border-[var(--color-border)] p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-semibold">{titleize(g.resource)}</span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(selectable, allOn)}
                      disabled={selectable.length === 0}
                      className="text-xs font-semibold text-[var(--color-brand)] disabled:opacity-40"
                    >
                      {allOn ? 'Clear' : 'All'}
                    </button>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {g.permissions.map((p) => {
                      const disabled = readOnly && !p.readOnly;
                      return (
                        <label
                          key={p.key}
                          className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                            disabled
                              ? 'cursor-not-allowed opacity-45'
                              : 'cursor-pointer hover:bg-[var(--color-surface-sunken)]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={perms.has(p.key)}
                            disabled={disabled}
                            onChange={() => togglePerm(p.key)}
                            className="size-4 accent-[var(--color-brand)]"
                          />
                          <span>{actionLabel(p.action)}</span>
                          {p.readOnly ? (
                            <span className="text-[10px] font-semibold uppercase text-[var(--color-content-subtle)]">
                              read
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Segregation-of-duties warnings — saving requires explicit acknowledgment */}
      {sodConflicts.length > 0 ? (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-[var(--tone-warning-fg)]/30 bg-[var(--tone-warning-bg)] p-3"
        >
          <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--tone-warning-fg)]">
            <AlertTriangle className="size-4" />
            {sodConflicts.length} segregation-of-duties warning{sodConflicts.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-2 grid gap-1.5">
            {sodConflicts.map((c) => (
              <li key={c.id} className="text-[12.5px] leading-snug text-[var(--tone-warning-fg)]">
                {c.reason}
              </li>
            ))}
          </ul>
          <label className="mt-2.5 flex items-start gap-2 text-[12.5px] font-medium text-[var(--tone-warning-fg)]">
            <input
              type="checkbox"
              checked={sodAcknowledged}
              onChange={(e) => setSodAcknowledged(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--tone-warning-fg)]"
            />
            I understand this role combines conflicting duties, and I accept the risk.
          </label>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <div>
          {!isNew ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-[var(--color-content-muted)]">Delete this role?</span>
                <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={inUse}
                title={inUse ? 'Reassign its members before deleting' : undefined}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )
          ) : null}
          {inUse ? (
            <p className="mt-1 text-xs text-[var(--color-content-subtle)]">
              In use by {loaded?.userCount} member{loaded?.userCount === 1 ? '' : 's'} — reassign to delete.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            disabled={name.trim().length < 2 || sodBlocked}
            title={sodBlocked ? 'Acknowledge the segregation-of-duties warnings first' : undefined}
            onClick={() => save.mutate()}
          >
            {isNew ? 'Create role' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Badge({
  children,
  tone,
  icon,
}: {
  children: React.ReactNode;
  tone: 'neutral' | 'info';
  icon?: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: `var(--tone-${tone}-fg)`, background: `var(--tone-${tone}-bg)` }}
    >
      {icon}
      {children}
    </span>
  );
}
