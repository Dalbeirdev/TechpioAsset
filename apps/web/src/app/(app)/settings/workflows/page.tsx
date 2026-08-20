'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Users } from 'lucide-react';
import { PERMISSIONS } from '@techpioasset/domain';
import type { WorkflowDefinition, WorkflowStep } from '@techpioasset/contracts';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/providers/auth-provider';
import { useToast } from '@/providers/toast-provider';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { Breadcrumbs } from '@/components/breadcrumbs';

/**
 * Approval workflows (v2.24).
 *
 * The chains have been configurable in the data model since the beginning and
 * editable nowhere - `workflows:configure` was granted and enforced by no
 * route, so a cost threshold could only be changed by editing the database.
 *
 * Each step shows how many people could actually decide it, because that is
 * the failure worth seeing: a step that applies to every request with nobody
 * eligible is worse than one that rarely applies.
 *
 * Restructuring a chain - adding, removing or reordering steps, or changing
 * who approves - is deliberately not here. Those change what the process IS;
 * these tune one already agreed.
 */

const titleCase = (v: string) =>
  v.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export default function WorkflowSettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: () => apiFetch<WorkflowDefinition[]>('/workflows'),
    enabled: can(PERMISSIONS.WORKFLOWS_CONFIGURE),
  });

  const save = useMutation({
    mutationFn: (input: { stepId: string; costThreshold: string | null }) =>
      apiFetch(`/workflows/steps/${input.stepId}`, {
        method: 'PATCH',
        body: { costThreshold: input.costThreshold },
      }),
    onSuccess: async (_r, input) => {
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setDraft((prev) => {
        const next = { ...prev };
        delete next[input.stepId];
        return next;
      });
      toast.success(
        input.costThreshold === null
          ? 'This step now applies to every request'
          : `This step now applies from ${input.costThreshold}`,
      );
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save the change',
      ),
  });

  if (!can(PERMISSIONS.WORKFLOWS_CONFIGURE)) {
    return <ErrorState title="Not available" detail="Configuring approval workflows needs the workflows:configure permission." />;
  }
  if (workflows.isPending) return <Skeleton className="h-96" />;
  if (workflows.isError) {
    return <ErrorState title="Could not load workflows" detail={(workflows.error as Error).message} />;
  }

  return (
    <div className="grid gap-4">
      <header>
        <Breadcrumbs items={[{ label: 'Settings' }, { label: 'Approval workflows' }]} />
        <h1 className="text-xl font-semibold tracking-tight">Approval workflows</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Which requests each step reviews. A step with no threshold reviews every request; one
          with a threshold only sees requests estimated at or above it.
        </p>
      </header>

      {workflows.data.map((workflow) => (
        <Card key={workflow.id} className="p-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">{workflow.name}</h2>
            <span className="text-xs text-[var(--color-content-subtle)]">
              {workflow.requestType ? titleCase(workflow.requestType) : 'Every other request type'}
            </span>
          </div>

          <ol className="mt-4 grid gap-2">
            {workflow.steps.map((step) => (
              <StepRow
                key={step.id}
                step={step}
                draft={draft[step.id]}
                onDraft={(v) => setDraft((prev) => ({ ...prev, [step.id]: v }))}
                onSave={(costThreshold) => save.mutate({ stepId: step.id, costThreshold })}
                saving={save.isPending}
              />
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}

function StepRow({
  step,
  draft,
  onDraft,
  onSave,
  saving,
}: {
  step: WorkflowStep;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onSave: (costThreshold: string | null) => void;
  saving: boolean;
}) {
  const current = step.costThreshold ?? '';
  const value = draft ?? current;
  const dirty = value.trim() !== current;
  const unstaffed = step.eligibleApprovers === 0;

  return (
    <li className="grid gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {step.stepOrder}. {step.name}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-content-muted)]">
          <span>
            {step.approverType === 'LINE_MANAGER'
              ? 'The requester’s manager, or the Manager role'
              : (step.approverRoleName ?? titleCase(step.approverType))}
          </span>
          <span
            className="inline-flex items-center gap-1"
            style={unstaffed ? { color: 'var(--tone-critical-fg)' } : undefined}
          >
            {unstaffed ? (
              <AlertTriangle aria-hidden="true" className="size-3.5" />
            ) : (
              <Users aria-hidden="true" className="size-3.5" />
            )}
            {unstaffed
              ? 'nobody holds this — the step is skipped'
              : `${step.eligibleApprovers} can approve`}
          </span>
          <span>
            {step.costThreshold
              ? `only from ${step.costThreshold}`
              : 'reviews every request'}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 justify-self-start sm:justify-self-end">
        <label className="sr-only" htmlFor={`threshold-${step.id}`}>
          Cost threshold for {step.name}
        </label>
        <Input
          id={`threshold-${step.id}`}
          value={value}
          inputMode="decimal"
          placeholder="No threshold"
          onChange={(e) => onDraft(e.target.value)}
          className="h-9 w-36"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!dirty || saving}
          onClick={() => onSave(value.trim() === '' ? null : value.trim())}
        >
          Save
        </Button>
        {step.costThreshold ? (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => onSave(null)}>
            Review everything
          </Button>
        ) : null}
      </div>
    </li>
  );
}
