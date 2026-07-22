import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  isTerminal,
  nextStates,
  IllegalTransitionError,
  type StateMachine,
} from './state-machine';
import { ASSET_STATUSES, assetStatusMachine, type AssetStatus } from './asset-status';
import { REQUEST_STATUSES, requestStatusMachine, isRequestOpen } from './request-status';
import {
  VERIFICATION_STATUSES,
  verificationStatusMachine,
  assertHumanDecisionOnly,
  requiresHumanDecision,
  AutomatedApprovalError,
} from './verification-status';

/**
 * Structural invariants every machine must hold. Run against all three so a
 * typo in a transition table fails the build rather than surfacing as a stuck
 * record in production.
 */
function assertMachineIsWellFormed<S extends string>(
  machine: StateMachine<S>,
  allStates: readonly S[],
): void {
  const known = new Set<string>(allStates);

  for (const state of allStates) {
    expect(machine.transitions[state], `${state} missing from transition table`).toBeDefined();
  }

  expect(Object.keys(machine.transitions).sort()).toEqual([...allStates].sort());

  for (const [from, targets] of Object.entries(machine.transitions) as [S, readonly S[]][]) {
    for (const to of targets) {
      expect(known.has(to), `${from} -> ${to} targets an unknown state`).toBe(true);
    }
    expect(new Set(targets).size, `${from} has duplicate targets`).toBe(targets.length);
    expect(targets, `${from} lists itself as a transition`).not.toContain(from);
  }

  for (const terminal of machine.terminal) {
    expect(machine.transitions[terminal], `terminal ${terminal} has outgoing edges`).toEqual([]);
  }

  // Every non-initial state must be reachable, otherwise it is dead config.
  const reachable = new Set<S>([machine.initial]);
  const queue: S[] = [machine.initial];
  while (queue.length > 0) {
    const current = queue.shift() as S;
    for (const next of machine.transitions[current] ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  for (const state of allStates) {
    expect(reachable.has(state), `${state} is unreachable from ${machine.initial}`).toBe(true);
  }
}

describe('state machine helpers', () => {
  it('treats a no-op transition as legal', () => {
    expect(canTransition(assetStatusMachine, 'AVAILABLE', 'AVAILABLE')).toBe(true);
  });

  it('throws IllegalTransitionError with both states named', () => {
    expect(() => assertTransition(assetStatusMachine, 'DISPOSED', 'AVAILABLE')).toThrow(
      IllegalTransitionError,
    );
    expect(() => assertTransition(assetStatusMachine, 'DISPOSED', 'AVAILABLE')).toThrow(
      /DISPOSED -> AVAILABLE/,
    );
  });

  it('reports terminal states', () => {
    expect(isTerminal(assetStatusMachine, 'DISPOSED')).toBe(true);
    expect(isTerminal(assetStatusMachine, 'AVAILABLE')).toBe(false);
    expect(nextStates(assetStatusMachine, 'DONATED')).toEqual([]);
  });
});

describe('asset status machine', () => {
  it('declares all 18 statuses from spec section 7', () => {
    expect(ASSET_STATUSES).toHaveLength(18);
  });

  it('is well formed', () => {
    assertMachineIsWellFormed(assetStatusMachine, ASSET_STATUSES);
  });

  it('allows the standard assign / return / redeploy cycle', () => {
    const path: AssetStatus[] = ['AVAILABLE', 'ASSIGNED', 'IN_USE', 'RETURNED', 'AVAILABLE'];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(assetStatusMachine, path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('never resurrects a disposed or donated asset', () => {
    for (const status of ASSET_STATUSES) {
      expect(canTransition(assetStatusMachine, 'DISPOSED', status)).toBe(status === 'DISPOSED');
      expect(canTransition(assetStatusMachine, 'DONATED', status)).toBe(status === 'DONATED');
    }
  });

  it('does not allow an ordered asset to skip receipt', () => {
    expect(canTransition(assetStatusMachine, 'ORDERED', 'ASSIGNED')).toBe(false);
    expect(canTransition(assetStatusMachine, 'ORDERED', 'AVAILABLE')).toBe(false);
  });
});

describe('request status machine', () => {
  it('declares all 16 statuses from spec section 11', () => {
    expect(REQUEST_STATUSES).toHaveLength(16);
  });

  it('is well formed', () => {
    assertMachineIsWellFormed(requestStatusMachine, REQUEST_STATUSES);
  });

  it('walks the spec section 11 laptop workflow end to end', () => {
    const path = [
      'DRAFT',
      'SUBMITTED',
      'MANAGER_APPROVAL_PENDING',
      'HR_REVIEW_PENDING',
      'IT_REVIEW_PENDING',
      'FINANCE_APPROVAL_PENDING',
      'APPROVED',
      'INVENTORY_RESERVED',
      'READY_FOR_ASSIGNMENT',
      'ASSIGNED',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(
        canTransition(requestStatusMachine, path[i]!, path[i + 1]!),
        `${path[i]} -> ${path[i + 1]}`,
      ).toBe(true);
    }
  });

  it('cannot cancel a request once the asset is in the employee’s hands', () => {
    expect(canTransition(requestStatusMachine, 'ASSIGNED', 'CANCELLED')).toBe(false);
  });

  it('classifies open versus closed requests', () => {
    expect(isRequestOpen('IT_REVIEW_PENDING')).toBe(true);
    expect(isRequestOpen('COMPLETED')).toBe(false);
    expect(isRequestOpen('REJECTED')).toBe(false);
    expect(isRequestOpen('CANCELLED')).toBe(false);
  });
});

describe('verification status machine', () => {
  it('declares all 16 statuses from spec section 9', () => {
    expect(VERIFICATION_STATUSES).toHaveLength(16);
  });

  it('is well formed', () => {
    assertMachineIsWellFormed(verificationStatusMachine, VERIFICATION_STATUSES);
  });

  it('supports the AI-disabled path straight from upload to human review', () => {
    expect(canTransition(verificationStatusMachine, 'UPLOADED', 'PENDING_REVIEW')).toBe(true);
  });

  it('does not let an upload jump directly to verified', () => {
    expect(canTransition(verificationStatusMachine, 'UPLOADED', 'VERIFIED')).toBe(false);
    expect(canTransition(verificationStatusMachine, 'AI_PROCESSING', 'VERIFIED')).toBe(false);
    expect(canTransition(verificationStatusMachine, 'EXTRACTION_COMPLETED', 'VERIFIED')).toBe(
      false,
    );
  });

  it('flags the two statuses that require a human', () => {
    expect(requiresHumanDecision('VERIFIED')).toBe(true);
    expect(requiresHumanDecision('REJECTED')).toBe(true);
    expect(requiresHumanDecision('COST_MISMATCH')).toBe(false);
  });

  it('refuses an automated final approval', () => {
    expect(() => assertHumanDecisionOnly('VERIFIED', { automated: true })).toThrow(
      AutomatedApprovalError,
    );
    expect(() => assertHumanDecisionOnly('VERIFIED', null)).toThrow(AutomatedApprovalError);
    expect(() => assertHumanDecisionOnly('VERIFIED', { userId: '' })).toThrow(
      AutomatedApprovalError,
    );
  });

  it('permits a human final approval and ignores non-final statuses', () => {
    expect(() => assertHumanDecisionOnly('VERIFIED', { userId: 'usr_1' })).not.toThrow();
    expect(() => assertHumanDecisionOnly('COST_MISMATCH', { automated: true })).not.toThrow();
  });
});
