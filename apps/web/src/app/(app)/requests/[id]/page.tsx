'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDashed, CircleX, Clock, MinusCircle } from 'lucide-react';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { PERMISSIONS, type RequestStatus } from '@techpioasset/domain';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { StatusBadge } from '@/components/status-badge';
import { Breadcrumbs } from '@/components/breadcrumbs';

interface Approval {
  id: string;
  stepOrder: number;
  stepName: string;
  approverType: string;
  decision: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'DELEGATED';
  decidedAt: string | null;
  comment: string | null;
  approver: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
}

interface RequestDetail {
  id: string;
  requestNumber: string;
  type: string;
  status: RequestStatus;
  priority: string;
  businessReason: string;
  requiredBy: string | null;
  estimatedCost: string | null;
  currency: string | null;
  createdAt: string;
  requester: { id: string; email: string; profile: { firstName: string; lastName: string } | null };
  beneficiary: {
    id: string;
    email: string;
    profile: { firstName: string; lastName: string } | null;
  } | null;
  items: { id: string; description: string; quantity: string; estimatedCost: string | null }[];
  approvals: Approval[];
  /** Server-resolved: whether this caller may act on the current step. */
  canDecide: boolean;
  comments: {
    id: string;
    body: string;
    isInternal: boolean;
    createdAt: string;
    author: {
      id: string;
      email: string;
      profile: { firstName: string; lastName: string } | null;
    } | null;
  }[];
}

const DECISION_ICON = {
  WAITING: CircleDashed,
  PENDING: Clock,
  APPROVED: Check,
  REJECTED: CircleX,
  SKIPPED: MinusCircle,
  DELEGATED: CircleDashed,
} as const;

const DECISION_TONE = {
  WAITING: 'muted',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'critical',
  SKIPPED: 'muted',
  DELEGATED: 'info',
} as const;

function personName(
  person: { email: string; profile: { firstName: string; lastName: string } | null } | null,
) {
  if (!person) return '—';
  return person.profile ? `${person.profile.firstName} ${person.profile.lastName}` : person.email;
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['request', id],
    queryFn: () => apiFetch<RequestDetail>(`/requests/${id}`),
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      apiFetch(`/requests/${id}/decision`, {
        method: 'POST',
        body: { decision, ...(comment ? { comment } : {}) },
      }),
    onSuccess: async (_data, decision) => {
      setComment('');
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['request', id] });
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(decision === 'APPROVED' ? 'Request approved' : 'Request rejected');
    },
    onError: (caught) => {
      const message =
        caught instanceof ApiError
          ? (caught.problem.detail ?? caught.problem.title)
          : 'Could not record the decision.';
      setActionError(message);
      toast.error(message);
    },
  });

  if (isPending) return <Skeleton className="h-96" />;
  if (isError) {
    return <ErrorState title="Could not load this request" detail={(error as Error).message} />;
  }

  // The step currently on someone's desk. `canDecide` comes from the server,
  // which is the only party that knows the step's approver rules - the local
  // permission check alone would offer an Approve button that 403s on click.
  const currentStep = data.approvals.find((a) => a.decision === 'PENDING');
  const canAct = Boolean(currentStep) && can(PERMISSIONS.REQUESTS_APPROVE) && data.canDecide;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <Breadcrumbs
        items={[{ label: 'Requests', href: '/requests' }, { label: data.requestNumber }]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{data.requestNumber}</h1>
            <StatusBadge token={REQUEST_STATUS_TOKENS[data.status]} size="sm" />
          </div>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Raised by {personName(data.requester)}
            {data.beneficiary ? ` for ${personName(data.beneficiary)}` : ''} ·{' '}
            {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>
        {data.estimatedCost ? (
          <div className="text-right">
            <p className="text-xs text-[var(--color-content-subtle)]">Estimate</p>
            <p className="text-lg font-semibold tabular-nums">
              {data.currency} {Number(data.estimatedCost).toLocaleString()}
            </p>
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">Business reason</h2>
            <p className="mt-2 text-sm text-[var(--color-content-muted)]">{data.businessReason}</p>

            <h2 className="mt-5 text-sm font-semibold">Items</h2>
            <ul className="mt-2 divide-y divide-[var(--color-border)] text-sm">
              {data.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {item.description}
                    <span className="text-[var(--color-content-subtle)]">
                      {' '}
                      × {Number(item.quantity)}
                    </span>
                  </span>
                  {item.estimatedCost ? (
                    <span className="tabular-nums text-[var(--color-content-muted)]">
                      {Number(item.estimatedCost).toLocaleString()}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          {canAct ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Your decision — {currentStep?.stepName}</h2>
              <label htmlFor="decision-comment" className="mt-3 block text-xs font-medium">
                Comment (optional)
              </label>
              <textarea
                id="decision-comment"
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2.5 text-sm"
              />

              {actionError ? (
                <p
                  role="alert"
                  className="mt-2 text-xs"
                  style={{ color: 'var(--tone-critical-fg)' }}
                >
                  {actionError}
                </p>
              ) : null}

              <div className="mt-3 flex justify-end gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  loading={decide.isPending}
                  onClick={() => decide.mutate('REJECTED')}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  loading={decide.isPending}
                  onClick={() => decide.mutate('APPROVED')}
                >
                  Approve
                </Button>
              </div>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="text-sm font-semibold">Comments</h2>
            {data.comments.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-content-subtle)]">No comments yet.</p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {data.comments.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{personName(c.author)}</span>
                      {c.isInternal ? (
                        <span
                          className="rounded-full border px-1.5 py-0.5 text-[10px]"
                          style={{
                            color: 'var(--tone-warning-fg)',
                            backgroundColor: 'var(--tone-warning-bg)',
                            borderColor: 'var(--tone-warning-border)',
                          }}
                        >
                          Internal
                        </span>
                      ) : null}
                      <span className="text-xs text-[var(--color-content-subtle)]">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[var(--color-content-muted)]">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-semibold">Approval chain</h2>
          <ol className="mt-3 grid gap-3">
            {data.approvals.map((approval) => {
              const Icon = DECISION_ICON[approval.decision];
              const tone = DECISION_TONE[approval.decision];
              return (
                <li key={approval.id} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border"
                    style={{
                      color: `var(--tone-${tone}-fg)`,
                      backgroundColor: `var(--tone-${tone}-bg)`,
                      borderColor: `var(--tone-${tone}-border)`,
                    }}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{approval.stepName}</p>
                    <p className="text-xs text-[var(--color-content-subtle)]">
                      {approval.decision === 'WAITING'
                        ? 'Queued'
                        : approval.decision === 'PENDING'
                          ? 'Awaiting decision'
                          : `${approval.decision.charAt(0)}${approval.decision.slice(1).toLowerCase()}${
                              approval.approver ? ` by ${personName(approval.approver)}` : ''
                            }`}
                    </p>
                    {approval.comment ? (
                      <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                        “{approval.comment}”
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
