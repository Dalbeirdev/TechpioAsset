'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wallet } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import { apiFetch, apiFetchPage } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { fmtDate, inputCls } from '@/components/procurement/shared';

/**
 * v2.9 C2 — where the money a department may spend actually lives.
 *
 * A budget is a money figure, so this whole page sits behind the standing
 * Finance + Super Admin rule; the nav entry is hidden for everyone else.
 */

interface CostCentre {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
interface Budget {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  amount: string;
  committed: string;
  remaining: string;
  utilisationPercent: number;
  costCentre: { id: string; code: string; name: string };
}
interface Report {
  on: string;
  rows: Budget[];
  totals: { amount: string; committed: string; remaining: string };
}

/** Green under 75%, amber to 90%, red past it: the colour IS the warning. */
function utilisationTone(percent: number) {
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warning';
  return 'success';
}

export default function BudgetsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = can(PERMISSIONS.FINANCE_BUDGETS_MANAGE);
  const [showNew, setShowNew] = useState(false);
  const [newCentre, setNewCentre] = useState({ code: '', name: '' });
  const [form, setForm] = useState({
    costCentreId: '',
    name: '',
    periodStart: '',
    periodEnd: '',
    currency: 'USD',
    amount: '',
  });

  const report = useQuery({
    queryKey: ['budget-report'],
    queryFn: () => apiFetch<Report>('/budgets/report'),
  });
  const centres = useQuery({
    queryKey: ['cost-centres'],
    queryFn: () => apiFetchPage<CostCentre>('/cost-centres?pageSize=100&activeOnly=true'),
  });

  const createCentre = useMutation({
    mutationFn: () =>
      apiFetch('/cost-centres', {
        method: 'POST',
        body: { code: newCentre.code.trim(), name: newCentre.name.trim() },
      }),
    onSuccess: () => {
      toast.success('Cost centre created');
      setNewCentre({ code: '', name: '' });
      void qc.invalidateQueries({ queryKey: ['cost-centres'] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create the cost centre'),
  });

  const create = useMutation({
    mutationFn: () => apiFetch('/budgets', { method: 'POST', body: form }),
    onSuccess: () => {
      toast.success('Budget set');
      setShowNew(false);
      setForm({ costCentreId: '', name: '', periodStart: '', periodEnd: '', currency: 'USD', amount: '' });
      void qc.invalidateQueries({ queryKey: ['budget-report'] });
    },
    // Overlapping periods and "already committed" refusals speak for themselves.
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not set the budget'),
  });

  if (report.isPending) return <Skeleton className="h-96" />;
  if (report.isError) {
    return <ErrorState title="Could not load budgets" detail={(report.error as Error).message} />;
  }

  const valid = form.costCentreId && form.name.trim().length >= 2 && form.periodStart && form.periodEnd && form.amount;

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--color-content-subtle)]">
            Finance
          </span>
          <h1 className="mt-1 flex items-center gap-2 text-[24px] font-bold tracking-tight">
            <Wallet className="size-6 text-[var(--color-brand)]" /> Budgets
          </h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            What each cost centre may spend, and what approved requests are already holding against it.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setShowNew((v) => !v)}>
            <Plus className="size-4" /> Set a budget
          </Button>
        ) : null}
      </header>

      {showNew && canManage ? (
        <Card className="grid gap-3 p-4 sm:grid-cols-2">
          <div>
            <label htmlFor="b-cc" className="mb-1 block text-[13px] font-medium">Cost centre</label>
            <select
              id="b-cc"
              value={form.costCentreId}
              onChange={(e) => setForm((f) => ({ ...f, costCentreId: e.target.value }))}
              className={inputCls}
            >
              <option value="">Choose…</option>
              {(centres.data?.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="b-name" className="mb-1 block text-[13px] font-medium">Name</label>
            <input
              id="b-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="FY26 Q1 — IT"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="b-start" className="mb-1 block text-[13px] font-medium">Period start</label>
            <input
              id="b-start"
              type="date"
              value={form.periodStart}
              onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="b-end" className="mb-1 block text-[13px] font-medium">Period end</label>
            <input
              id="b-end"
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="b-amount" className="mb-1 block text-[13px] font-medium">Amount</label>
            <input
              id="b-amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="25000.00"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="b-ccy" className="mb-1 block text-[13px] font-medium">Currency</label>
            <input
              id="b-ccy"
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
              maxLength={3}
              className={`${inputCls} w-24`}
            />
          </div>
          <div className="sm:col-span-2">
            <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate()}>
              Set budget
            </Button>
          </div>
        </Card>
      ) : null}

      {canManage ? (
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Cost centres</h2>
          <p className="mt-0.5 text-xs text-[var(--color-content-muted)]">
            The unit a budget is set for and a purchase is charged to. Departments are an org chart,
            which is a different question.
          </p>
          {(centres.data?.data.length ?? 0) > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {(centres.data?.data ?? []).map((c) => (
                <li
                  key={c.id}
                  className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs"
                >
                  <span className="font-semibold">{c.code}</span>{' '}
                  <span className="text-[var(--color-content-muted)]">{c.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--color-content-subtle)]">None yet.</p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="cc-code" className="mb-1 block text-[13px] font-medium">Code</label>
              <input
                id="cc-code"
                value={newCentre.code}
                onChange={(e) => setNewCentre((c) => ({ ...c, code: e.target.value }))}
                placeholder="IT-OPS"
                className={`${inputCls} w-32`}
              />
            </div>
            <div>
              <label htmlFor="cc-name" className="mb-1 block text-[13px] font-medium">Name</label>
              <input
                id="cc-name"
                value={newCentre.name}
                onChange={(e) => setNewCentre((c) => ({ ...c, name: e.target.value }))}
                placeholder="IT Operations"
                className={`${inputCls} w-56`}
              />
            </div>
            <Button
              variant="secondary"
              loading={createCentre.isPending}
              disabled={!newCentre.code.trim() || newCentre.name.trim().length < 2}
              onClick={() => createCentre.mutate()}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </Card>
      ) : null}

      {report.data.rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-semibold">No budget covers today</p>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Until a cost centre has a budget for the current period, requests charged to it cannot be
            approved — the approval says so rather than guessing.
          </p>
        </Card>
      ) : (
        <>
          <Card className="grid gap-3 p-4 sm:grid-cols-3">
            {[
              ['Budgeted', report.data.totals.amount],
              ['Committed', report.data.totals.committed],
              ['Remaining', report.data.totals.remaining],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-content-subtle)]">
                  {label}
                </p>
                <p className="mt-0.5 text-[22px] font-bold tabular-nums">{Number(value).toLocaleString()}</p>
              </div>
            ))}
          </Card>

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-content-subtle)]">
                  <th className="px-4 py-3 font-semibold">Cost centre</th>
                  <th className="px-4 py-3 font-semibold">Period</th>
                  <th className="px-4 py-3 font-semibold">Consumption</th>
                  <th className="px-4 py-3 text-right font-semibold">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {report.data.rows.map((b) => {
                  const tone = utilisationTone(b.utilisationPercent);
                  return (
                    <tr key={b.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{b.costCentre.code}</p>
                        <p className="text-xs text-[var(--color-content-subtle)]">{b.name}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-content-muted)]">
                        {fmtDate(b.periodStart)} → {fmtDate(b.periodEnd)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-40">
                          <span className="text-xs font-semibold tabular-nums">
                            {Number(b.committed).toLocaleString()} / {Number(b.amount).toLocaleString()}{' '}
                            {b.currency} · {b.utilisationPercent}%
                          </span>
                          <div className="mt-1 h-1.5 rounded-full bg-[var(--color-surface-sunken)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, b.utilisationPercent)}%`,
                                background: `var(--tone-${tone}-solid)`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {Number(b.remaining).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
