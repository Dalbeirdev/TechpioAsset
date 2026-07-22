import type { RequestStatus } from './request-status';
import type { SystemRole } from './permissions';

/**
 * Approval workflow rules (spec section 11).
 *
 * The *order* of steps is configuration, held in WorkflowDefinition rows a Super
 * Admin can edit. What lives here is the part that is not configurable: which
 * request status corresponds to waiting on which approver, and when a step is
 * skipped. Both are pure functions so they can be tested without a database.
 */

export const APPROVER_TYPES = ['ROLE', 'USER', 'LINE_MANAGER', 'DEPARTMENT_HEAD'] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

/**
 * The status a request sits in while a given role is reviewing.
 *
 * Derived from the role rather than stored on the step, so a workflow reordered
 * by an administrator cannot produce a step whose status label contradicts its
 * approver.
 */
const ROLE_TO_PENDING_STATUS: Partial<Record<SystemRole, RequestStatus>> = {
  MANAGER: 'MANAGER_APPROVAL_PENDING',
  HR: 'HR_REVIEW_PENDING',
  IT_ADMIN: 'IT_REVIEW_PENDING',
  OFFICE_ADMIN: 'OFFICE_ADMIN_REVIEW_PENDING',
  FINANCE: 'FINANCE_APPROVAL_PENDING',
};

export function pendingStatusForApprover(input: {
  approverType: ApproverType;
  approverRoleKey?: string | null;
}): RequestStatus {
  if (input.approverType === 'LINE_MANAGER' || input.approverType === 'DEPARTMENT_HEAD') {
    return 'MANAGER_APPROVAL_PENDING';
  }
  const mapped = input.approverRoleKey
    ? ROLE_TO_PENDING_STATUS[input.approverRoleKey as SystemRole]
    : undefined;
  // A step naming a custom role has no dedicated status; SUBMITTED is the honest
  // fallback - the request is open and awaiting someone.
  return mapped ?? 'SUBMITTED';
}

export interface WorkflowStepLike {
  stepOrder: number;
  approverType: ApproverType;
  approverRoleKey?: string | null;
  approverUserId?: string | null;
  /** Step applies only when the request total exceeds this. */
  costThreshold?: string | number | null;
  isSkippable: boolean;
}

/**
 * Spec section 11: kitchen requests need finance or manager approval "only above
 * a configurable cost threshold".
 *
 * A step with a threshold is skipped when the estimate is at or below it. An
 * *unknown* cost never skips: absent an estimate the safe reading is that the
 * request might exceed the threshold, so it goes to a human.
 */
export function shouldSkipStep(
  step: WorkflowStepLike,
  estimatedCost: string | number | null | undefined,
): boolean {
  if (step.costThreshold === null || step.costThreshold === undefined) return false;
  if (estimatedCost === null || estimatedCost === undefined) return false;

  const threshold = Number(step.costThreshold);
  const cost = Number(estimatedCost);
  if (!Number.isFinite(threshold) || !Number.isFinite(cost)) return false;

  return cost <= threshold;
}

/** Steps that actually apply to a request, in order. */
export function resolveApplicableSteps<T extends WorkflowStepLike>(
  steps: readonly T[],
  estimatedCost: string | number | null | undefined,
): T[] {
  return [...steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .filter((step) => !shouldSkipStep(step, estimatedCost));
}

/**
 * Whether a user may act on a step.
 *
 * A LINE_MANAGER step is satisfied by the requester's actual manager, not by
 * anyone holding a manager-ish role - otherwise any manager in the company could
 * approve any request.
 */
export function canApproveStep(input: {
  step: WorkflowStepLike;
  actorId: string;
  actorRoleKeys: readonly string[];
  requesterManagerId?: string | null;
  requesterDepartmentHeadId?: string | null;
}): boolean {
  const { step, actorId, actorRoleKeys } = input;

  switch (step.approverType) {
    case 'USER':
      return step.approverUserId === actorId;
    case 'LINE_MANAGER':
      return Boolean(input.requesterManagerId) && input.requesterManagerId === actorId;
    case 'DEPARTMENT_HEAD':
      return (
        Boolean(input.requesterDepartmentHeadId) && input.requesterDepartmentHeadId === actorId
      );
    case 'ROLE':
    default:
      return (
        Boolean(step.approverRoleKey) && actorRoleKeys.includes(step.approverRoleKey as string)
      );
  }
}
