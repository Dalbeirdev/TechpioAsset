'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Check, CircleDashed, CircleX, Clock, MinusCircle, Paperclip, Trash2 } from 'lucide-react';
import { REQUEST_STATUS_TOKENS } from '@techpioasset/ui-tokens';
import { PERMISSIONS, findIssueCategory, type RequestStatus } from '@techpioasset/domain';
import { apiFetch, apiBaseUrl, getAccessToken, ApiError } from '@/lib/api-client';
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
  issueCategory: string | null;
  details: {
    targetAssetId?: string | null;
    upgradeType?: string | null;
    currentSpec?: string | null;
    requestedSpec?: string | null;
    replacementReason?: string | null;
    otherText?: string | null;
  } | null;
  aboutAsset: { id: string; assetTag: string; name: string; serialNumber: string | null } | null;
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
  items: {
    id: string;
    description: string;
    quantity: string;
    estimatedCost: string | null;
    isUncatalogued?: boolean;
    manufacturer?: string | null;
    model?: string | null;
    referenceUrl?: string | null;
    category?: { id: string; name: string } | null;
  }[];
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
  attachments: {
    id: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    caption: string | null;
    createdAt: string;
    uploadedById: string | null;
  }[];
  /** v2.23 - who the current step is with, and whether that is anybody. */
  waitingOn: {
    stepName: string;
    approverType: string;
    roleName: string | null;
    approvers: { id: string; name: string }[];
    blocked: boolean;
    blockedReason: string | null;
  } | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const { can, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['request', id],
    queryFn: () => apiFetch<RequestDetail>(`/requests/${id}`),
  });

  const canAddToCatalog = can(PERMISSIONS.ASSETS_CREATE);
  const canInternal = can(PERMISSIONS.REQUESTS_APPROVE);
  const [commentBody, setCommentBody] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const postComment = useMutation({
    mutationFn: (body: { body: string; isInternal: boolean }) =>
      apiFetch(`/requests/${id}/comments`, { method: 'POST', body }),
    onSuccess: async () => {
      setCommentBody('');
      setCommentInternal(false);
      await queryClient.invalidateQueries({ queryKey: ['request', id] });
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not send'),
  });
  const addToCatalog = useMutation({
    mutationFn: (body: { name: string; categoryId: string | null }) =>
      apiFetch('/requests/catalog-items', { method: 'POST', body }),
    onSuccess: (_r, body) => toast.success(`"${body.name}" added to the equipment catalog`),
    onError: (e) =>
      toast.error(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add to catalog'),
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
            <Link
              href={`/requests/${id}/print`}
              className="print-hidden inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)]"
            >
              <Printer aria-hidden="true" className="size-3.5" />
              PDF
            </Link>
          </div>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            Raised by {personName(data.requester)}
            {data.beneficiary ? ` for ${personName(data.beneficiary)}` : ''} ·{' '}
            {new Date(data.createdAt).toLocaleDateString()}
          </p>
        </div>
        {/* "0" is a truthy STRING - without the numeric check this block
            proudly announced "USD 0" on every estimate-less request. */}
        {data.estimatedCost && Number(data.estimatedCost) > 0 ? (
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
            {data.issueCategory ? (
              <div className="mb-4">
                <h2 className="text-sm font-semibold">Reported issue</h2>
                <p className="mt-1.5">
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{
                      background: 'var(--tone-warning-bg)',
                      color: 'var(--tone-warning-fg)',
                    }}
                  >
                    {findIssueCategory(data.issueCategory)?.label ?? data.issueCategory}
                  </span>
                </p>
              </div>
            ) : null}

            <h2 className="text-sm font-semibold">
              {data.issueCategory ? 'What is happening' : 'Business reason'}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-content-muted)]">{data.businessReason}</p>

            {data.aboutAsset || data.details ? (
              <div className="mt-5 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)]/60 p-3.5">
                <h2 className="text-sm font-semibold">Request details</h2>
                <dl className="mt-2 grid gap-1.5 text-sm">
                  {data.aboutAsset ? (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <dt className="text-xs text-[var(--color-content-subtle)]">About asset</dt>
                      <dd className="font-medium">
                        <Link href={`/assets/${data.aboutAsset.id}`} className="text-[var(--color-brand)] hover:underline">
                          {data.aboutAsset.name} · {data.aboutAsset.assetTag}
                        </Link>
                      </dd>
                    </div>
                  ) : null}
                  {data.details?.upgradeType ? (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <dt className="text-xs text-[var(--color-content-subtle)]">Upgrade</dt>
                      <dd className="font-medium">{data.details.upgradeType.replaceAll('_', ' ').toLowerCase()}</dd>
                    </div>
                  ) : null}
                  {data.details?.currentSpec || data.details?.requestedSpec ? (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <dt className="text-xs text-[var(--color-content-subtle)]">Change</dt>
                      <dd className="font-medium">
                        {data.details.currentSpec ?? '—'} → {data.details.requestedSpec ?? '—'}
                      </dd>
                    </div>
                  ) : null}
                  {data.details?.replacementReason ? (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <dt className="text-xs text-[var(--color-content-subtle)]">Replacement reason</dt>
                      <dd className="font-medium">{data.details.replacementReason.replaceAll('_', ' ').toLowerCase()}</dd>
                    </div>
                  ) : null}
                  {data.details?.otherText ? (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <dt className="text-xs text-[var(--color-content-subtle)]">Specified</dt>
                      <dd className="font-medium">{data.details.otherText}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : null}

            <h2 className="mt-5 text-sm font-semibold">Items</h2>
            <ul className="mt-2 divide-y divide-[var(--color-border)] text-sm">
              {data.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    {item.description}
                    <span className="text-[var(--color-content-subtle)]">
                      {' '}
                      × {Number(item.quantity)}
                    </span>
                    {item.isUncatalogued ? (
                      <span className="mt-1 block">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-tint-amber)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-tint-amber-fg)]">
                          ⚠ Item not currently in catalog
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--color-content-muted)]">
                          {[item.manufacturer, item.model, item.category?.name].filter(Boolean).join(' · ') || null}
                          {item.referenceUrl ? (
                            <>
                              {' '}
                              <a href={item.referenceUrl} target="_blank" rel="noreferrer noopener" className="text-[var(--color-brand)] hover:underline">
                                product link
                              </a>
                            </>
                          ) : null}
                        </span>
                        {canAddToCatalog ? (
                          <button
                            type="button"
                            disabled={addToCatalog.isPending}
                            onClick={() => addToCatalog.mutate({ name: item.description, categoryId: item.category?.id ?? null })}
                            className="mt-1 inline-flex items-center rounded-full border border-[var(--color-border-strong)] px-2.5 py-1 text-xs font-semibold text-[var(--color-brand)] hover:bg-[var(--color-surface-sunken)] disabled:opacity-50"
                          >
                            Add to catalog
                          </button>
                        ) : null}
                      </span>
                    ) : null}
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
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Attachments</h2>
              <label
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-strong)] px-2.5 text-xs font-medium hover:bg-[var(--color-surface-sunken)] ${
                  uploading ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                <Paperclip className="size-3.5" />
                {uploading ? 'Uploading…' : 'Add file'}
                <input
                  type="file"
                  className="sr-only"
                  disabled={uploading}
                  accept="application/pdf,image/jpeg,image/png,image/heic"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUploading(true);
                    try {
                      const form = new FormData();
                      form.append('file', file);
                      const res = await fetch(`${apiBaseUrl}/requests/${id}/attachments`, {
                        method: 'POST',
                        credentials: 'include',
                        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
                        body: form,
                      });
                      if (!res.ok) {
                        const problem = await res.json().catch(() => null);
                        throw new ApiError(problem, res.status);
                      }
                      toast.success('File attached');
                      await queryClient.invalidateQueries({ queryKey: ['request', id] });
                    } catch (caught) {
                      toast.error(
                        caught instanceof ApiError
                          ? (caught.problem?.detail ?? caught.problem?.title ?? 'Upload failed')
                          : 'Upload failed',
                      );
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>
            </div>
            {data.attachments.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-content-subtle)]">
                No files attached. Add a photo of the issue or a spec sheet.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {data.attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] px-3 py-2 text-sm"
                  >
                    <a
                      href={`${apiBaseUrl}/requests/${id}/attachments/${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-w-0 items-center gap-2 text-[var(--color-brand)] hover:underline"
                    >
                      <Paperclip className="size-3.5 shrink-0" />
                      <span className="truncate">{a.originalName}</span>
                      <span className="shrink-0 text-xs text-[var(--color-content-subtle)]">
                        {formatBytes(a.sizeBytes)}
                      </span>
                    </a>
                    {a.uploadedById === user?.id ? (
                      <button
                        type="button"
                        aria-label={`Remove ${a.originalName}`}
                        onClick={async () => {
                          try {
                            await apiFetch(`/requests/${id}/attachments/${a.id}`, { method: 'DELETE' });
                            toast.success('Attachment removed');
                            await queryClient.invalidateQueries({ queryKey: ['request', id] });
                          } catch {
                            toast.error('Could not remove');
                          }
                        }}
                        className="shrink-0 rounded p-1 text-[var(--color-content-subtle)] hover:text-[var(--tone-critical-fg)]"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold">Conversation</h2>
            {data.comments.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-content-subtle)]">
                No messages yet. Questions about this request — timelines, status, details — belong
                here; the right people are notified when you write.
              </p>
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

            <form
              className="mt-4 grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (commentBody.trim().length === 0 || postComment.isPending) return;
                postComment.mutate({ body: commentBody.trim(), isInternal: commentInternal });
              }}
            >
              <label htmlFor="req-comment" className="sr-only">
                Write a message
              </label>
              <textarea
                id="req-comment"
                rows={2}
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={
                  data.requester.id === user?.id || data.beneficiary?.id === user?.id
                    ? 'Ask a question about this request — e.g. how long will this take?'
                    : 'Reply to the requester — they are notified of your message.'
                }
                className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              />
              <div className="flex items-center justify-between gap-3">
                {canInternal ? (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--color-content-muted)]">
                    <input
                      type="checkbox"
                      checked={commentInternal}
                      onChange={(e) => setCommentInternal(e.target.checked)}
                    />
                    Internal note (hidden from the requester)
                  </label>
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  size="sm"
                  disabled={commentBody.trim().length === 0}
                  loading={postComment.isPending}
                >
                  Send
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-sm font-semibold">Approval chain</h2>
          {/* A step names a role or "the line manager", so a chain can point at
              nobody - a requester with no manager recorded, or a role no account
              holds. The request then waits forever and appears in no one's
              queue, while this panel looks exactly like a healthy one. */}
          {data.waitingOn ? (
            data.waitingOn.blocked ? (
              <p className="mt-3 rounded-[var(--radius-control)] border border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] p-3 text-xs text-[var(--tone-warning-fg)]">
                <span className="font-semibold">Nobody can approve this right now.</span>{' '}
                {data.waitingOn.blockedReason}
              </p>
            ) : (
              <p className="mt-3 text-xs text-[var(--color-content-muted)]">
                Waiting on {data.waitingOn.approvers.map((a) => a.name).join(', ')}
                {data.waitingOn.roleName ? ` (${data.waitingOn.roleName})` : ''}.
              </p>
            )
          ) : null}
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
