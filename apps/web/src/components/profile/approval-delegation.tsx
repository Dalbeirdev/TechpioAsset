'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserRoundCheck, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { fetchColleagues, colleagueName, type Colleague } from '@/lib/colleagues';
import { useToast } from '@/providers/toast-provider';
import { Button, Card } from '@/components/ui';

/**
 * Cover for absence (v2.26).
 *
 * The delegation engine has existed since v2.2 and works: it hands one person's
 * step authority to another for a window, and refuses to let a delegate approve
 * the delegator's own request. What it never had was a screen, so in practice
 * every approval desk was one person deep - a single approver on leave held up
 * every request that reached their step until they came back.
 *
 * Two things this screen deliberately does not do. It does not ask which steps
 * to delegate: authority is resolved at decide time from what the delegator
 * actually holds, so a narrower picker here would only be decorative. And it
 * does not warn that the delegate lacks `requests:approve` - the API refuses
 * that at the guard, and duplicating the rule in the browser invites the two
 * copies to drift.
 */

type Person = Colleague;

interface Delegation {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  reason: string | null;
  createdAt: string;
  delegate?: Person;
  delegator?: Person;
}

const nameOf = (p: Person | undefined) => (p ? colleagueName(p) : '—');

const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString() : null);

/** "3 Sep 2026 to 12 Sep 2026", or the open-ended forms, in one phrase. */
function windowLabel(d: Delegation): string {
  const from = fmt(d.startsAt);
  const to = fmt(d.endsAt);
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}, no end date`;
  if (to) return `until ${to}`;
  return 'Active now, until revoked';
}

export function ApprovalDelegation() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [delegateId, setDelegateId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');

  const delegations = useQuery({
    queryKey: ['delegations'],
    queryFn: () => apiFetch<{ given: Delegation[]; received: Delegation[] }>('/delegations'),
  });

  const colleagues = useQuery({
    queryKey: ['colleagues'],
    queryFn: fetchColleagues,
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['delegations'] });

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/delegations', {
        method: 'POST',
        body: {
          delegateId,
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          reason: reason.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success('Cover arranged');
      setDelegateId('');
      setStartsAt('');
      setEndsAt('');
      setReason('');
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not set up cover'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/delegations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Cover ended');
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not end this cover'),
  });

  const given = delegations.data?.given ?? [];
  const received = delegations.data?.received ?? [];

  const field =
    'h-9 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface-raised)] px-2 text-sm';

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-3 text-base font-semibold">
        <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand)]/10">
          <UserRoundCheck aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
        </span>
        Approval cover
      </h2>
      <p className="mb-4 text-xs text-[var(--color-content-subtle)]">
        Going on leave? Name someone to act on the approvals that would otherwise wait for you. They
        can never approve a request you raised yourself, and this grants them nothing beyond what
        you already hold.
      </p>

      {/* ── Arrange cover ─────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          aria-label="Who covers for you"
          value={delegateId}
          onChange={(e) => setDelegateId(e.target.value)}
          className={`${field} sm:col-span-2`}
        >
          <option value="">Choose who covers for you…</option>
          {(colleagues.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {nameOf(c)}
            </option>
          ))}
        </select>
        <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
          From (optional)
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={field}
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--color-content-subtle)]">
          Until (optional)
          <input
            type="date"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={field}
          />
        </label>
        <input
          aria-label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason — e.g. Annual leave"
          className={`${field} sm:col-span-2`}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
        Leave both dates empty and the cover starts now and runs until you end it.
      </p>
      <Button
        className="mt-3"
        size="sm"
        loading={create.isPending}
        disabled={!delegateId || create.isPending}
        onClick={() => create.mutate()}
      >
        Arrange cover
      </Button>

      {/* ── Cover you have arranged ───────────────────────────────────── */}
      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
        Cover you have arranged
      </h3>
      {given.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--color-content-muted)]">
          Nobody is covering your approvals.
        </p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {given.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium">{nameOf(d.delegate)}</span>
                <span className="text-[var(--color-content-muted)]"> · {windowLabel(d)}</span>
                {d.reason ? (
                  <span className="text-[var(--color-content-muted)]"> · {d.reason}</span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                loading={revoke.isPending}
                onClick={() => revoke.mutate(d.id)}
              >
                <X aria-hidden="true" className="size-3.5" />
                End
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Cover you are providing ───────────────────────────────────── */}
      {received.length > 0 ? (
        <>
          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
            You are covering for
          </h3>
          <ul className="mt-2 grid gap-2">
            {received.map((d) => (
              <li
                key={d.id}
                className="rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-3 py-2 text-sm"
              >
                <span className="font-medium">{nameOf(d.delegator)}</span>
                <span className="text-[var(--color-content-muted)]"> · {windowLabel(d)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-content-subtle)]">
            Only the person who arranged the cover can end it.
          </p>
        </>
      ) : null}
    </Card>
  );
}
