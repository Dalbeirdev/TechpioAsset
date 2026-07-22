import type { StateMachine } from './state-machine';

/** Spec section 9 - all 16 invoice verification statuses. */
export const VERIFICATION_STATUSES = [
  'UPLOADED',
  'PENDING_AI_PROCESSING',
  'AI_PROCESSING',
  'AI_FAILED',
  'EXTRACTION_COMPLETED',
  'PENDING_REVIEW',
  'MATCHED',
  'PARTIALLY_MATCHED',
  'DUPLICATE_SUSPECTED',
  'ASSET_MISSING',
  'QUANTITY_MISMATCH',
  'COST_MISMATCH',
  'SERIAL_NUMBER_MISMATCH',
  'MANUAL_REVIEW_REQUIRED',
  'VERIFIED',
  'REJECTED',
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Outcomes produced by the deterministic check engine, not by the AI provider. */
export const VERIFICATION_ISSUE_STATUSES: readonly VerificationStatus[] = [
  'MATCHED',
  'PARTIALLY_MATCHED',
  'DUPLICATE_SUSPECTED',
  'ASSET_MISSING',
  'QUANTITY_MISMATCH',
  'COST_MISMATCH',
  'SERIAL_NUMBER_MISMATCH',
];

/**
 * A reviewer re-running the deterministic checks can land on any other issue
 * outcome, escalate, or resolve. `self` is filtered out because `canTransition`
 * already treats a no-op as legal.
 */
const fromIssue = (self: VerificationStatus): readonly VerificationStatus[] =>
  [
    ...VERIFICATION_ISSUE_STATUSES,
    'PENDING_REVIEW' as const,
    'MANUAL_REVIEW_REQUIRED' as const,
    'VERIFIED' as const,
    'REJECTED' as const,
  ].filter((s) => s !== self);

export const verificationStatusMachine: StateMachine<VerificationStatus> = {
  name: 'VerificationStatus',
  initial: 'UPLOADED',
  terminal: ['VERIFIED', 'REJECTED'],
  transitions: {
    // PENDING_REVIEW directly from UPLOADED is the AI-disabled path (spec section 10):
    // manual entry must remain fully functional with no provider call.
    UPLOADED: ['PENDING_AI_PROCESSING', 'PENDING_REVIEW', 'MANUAL_REVIEW_REQUIRED'],
    PENDING_AI_PROCESSING: ['AI_PROCESSING', 'AI_FAILED', 'PENDING_REVIEW'],
    AI_PROCESSING: ['EXTRACTION_COMPLETED', 'AI_FAILED'],
    AI_FAILED: ['PENDING_AI_PROCESSING', 'PENDING_REVIEW', 'MANUAL_REVIEW_REQUIRED'],
    EXTRACTION_COMPLETED: [
      ...VERIFICATION_ISSUE_STATUSES,
      'PENDING_REVIEW',
      'MANUAL_REVIEW_REQUIRED',
    ],
    PENDING_REVIEW: fromIssue('PENDING_REVIEW'),
    MATCHED: fromIssue('MATCHED'),
    PARTIALLY_MATCHED: fromIssue('PARTIALLY_MATCHED'),
    DUPLICATE_SUSPECTED: fromIssue('DUPLICATE_SUSPECTED'),
    ASSET_MISSING: fromIssue('ASSET_MISSING'),
    QUANTITY_MISMATCH: fromIssue('QUANTITY_MISMATCH'),
    COST_MISMATCH: fromIssue('COST_MISMATCH'),
    SERIAL_NUMBER_MISMATCH: fromIssue('SERIAL_NUMBER_MISMATCH'),
    MANUAL_REVIEW_REQUIRED: ['VERIFIED', 'REJECTED'],
    VERIFIED: [],
    REJECTED: [],
  },
};

/**
 * Spec section 9: "Do not allow AI to make final financial approvals
 * automatically." These two statuses may only ever be written by a request
 * carrying an authenticated human reviewer; the invoice service asserts this and
 * `assertHumanDecisionOnly` exists so that rule is testable in isolation.
 */
export const VERIFICATION_STATUSES_REQUIRING_HUMAN: readonly VerificationStatus[] = [
  'VERIFIED',
  'REJECTED',
];

export class AutomatedApprovalError extends Error {
  constructor(status: VerificationStatus) {
    super(`Verification status ${status} requires an authenticated human reviewer`);
    this.name = 'AutomatedApprovalError';
  }
}

export function requiresHumanDecision(status: VerificationStatus): boolean {
  return VERIFICATION_STATUSES_REQUIRING_HUMAN.includes(status);
}

export function assertHumanDecisionOnly(
  status: VerificationStatus,
  actor: { userId?: string | null; automated?: boolean } | null | undefined,
): void {
  if (!requiresHumanDecision(status)) return;
  if (!actor || actor.automated === true || !actor.userId) {
    throw new AutomatedApprovalError(status);
  }
}
