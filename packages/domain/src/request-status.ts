import type { StateMachine } from './state-machine';

/** Spec section 11 - all 16 request statuses. */
export const REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'MANAGER_APPROVAL_PENDING',
  'HR_REVIEW_PENDING',
  'IT_REVIEW_PENDING',
  'OFFICE_ADMIN_REVIEW_PENDING',
  'FINANCE_APPROVAL_PENDING',
  'APPROVED',
  'REJECTED',
  'INVENTORY_RESERVED',
  'ORDERED',
  'RECEIVED',
  'READY_FOR_ASSIGNMENT',
  'ASSIGNED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * Review steps are mutually reachable rather than a fixed chain: spec section 11
 * requires Super Admins to configure step order, approvers, thresholds and
 * bypass rules per request type, so the *order* lives in WorkflowDefinition rows.
 * This machine enforces only what is structurally legal.
 */
export const REQUEST_REVIEW_STEPS: readonly RequestStatus[] = [
  'MANAGER_APPROVAL_PENDING',
  'HR_REVIEW_PENDING',
  'IT_REVIEW_PENDING',
  'OFFICE_ADMIN_REVIEW_PENDING',
  'FINANCE_APPROVAL_PENDING',
];

/**
 * A review step may hand off to any other review step (the configured workflow
 * decides which), or resolve the request. `self` is filtered out because
 * `canTransition` already treats a no-op as legal.
 */
const fromReviewStep = (self: RequestStatus): readonly RequestStatus[] =>
  [...REQUEST_REVIEW_STEPS, 'APPROVED' as const, 'REJECTED' as const, 'CANCELLED' as const].filter(
    (s) => s !== self,
  );

export const requestStatusMachine: StateMachine<RequestStatus> = {
  name: 'RequestStatus',
  initial: 'DRAFT',
  terminal: ['COMPLETED', 'REJECTED', 'CANCELLED'],
  transitions: {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: [...REQUEST_REVIEW_STEPS, 'APPROVED', 'REJECTED', 'CANCELLED'],
    MANAGER_APPROVAL_PENDING: fromReviewStep('MANAGER_APPROVAL_PENDING'),
    HR_REVIEW_PENDING: fromReviewStep('HR_REVIEW_PENDING'),
    IT_REVIEW_PENDING: fromReviewStep('IT_REVIEW_PENDING'),
    OFFICE_ADMIN_REVIEW_PENDING: fromReviewStep('OFFICE_ADMIN_REVIEW_PENDING'),
    FINANCE_APPROVAL_PENDING: fromReviewStep('FINANCE_APPROVAL_PENDING'),
    APPROVED: ['INVENTORY_RESERVED', 'ORDERED', 'READY_FOR_ASSIGNMENT', 'CANCELLED'],
    INVENTORY_RESERVED: ['READY_FOR_ASSIGNMENT', 'ORDERED', 'CANCELLED'],
    ORDERED: ['RECEIVED', 'CANCELLED'],
    RECEIVED: ['READY_FOR_ASSIGNMENT', 'CANCELLED'],
    READY_FOR_ASSIGNMENT: ['ASSIGNED', 'CANCELLED'],
    // Once the employee holds the asset the request can only be closed by the
    // receipt confirmation; cancelling here would orphan a live assignment.
    ASSIGNED: ['COMPLETED'],
    COMPLETED: [],
    REJECTED: [],
    CANCELLED: [],
  },
};

/** Statuses where the request is waiting on a human decision. */
export const REQUEST_STATUSES_AWAITING_APPROVAL: readonly RequestStatus[] = REQUEST_REVIEW_STEPS;

export function isRequestOpen(status: RequestStatus): boolean {
  return !requestStatusMachine.terminal.includes(status);
}
