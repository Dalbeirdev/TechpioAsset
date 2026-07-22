import { describe, it, expect } from 'vitest';
import {
  pendingStatusForApprover,
  shouldSkipStep,
  resolveApplicableSteps,
  canApproveStep,
  type WorkflowStepLike,
} from './workflow';

const step = (over: Partial<WorkflowStepLike> = {}): WorkflowStepLike => ({
  stepOrder: 1,
  approverType: 'ROLE',
  approverRoleKey: 'FINANCE',
  isSkippable: false,
  ...over,
});

describe('pendingStatusForApprover', () => {
  it.each([
    ['MANAGER', 'MANAGER_APPROVAL_PENDING'],
    ['HR', 'HR_REVIEW_PENDING'],
    ['IT_ADMIN', 'IT_REVIEW_PENDING'],
    ['OFFICE_ADMIN', 'OFFICE_ADMIN_REVIEW_PENDING'],
    ['FINANCE', 'FINANCE_APPROVAL_PENDING'],
  ])('maps role %s to %s', (role, expected) => {
    expect(pendingStatusForApprover({ approverType: 'ROLE', approverRoleKey: role })).toBe(
      expected,
    );
  });

  it('treats line manager and department head as manager approval', () => {
    expect(pendingStatusForApprover({ approverType: 'LINE_MANAGER' })).toBe(
      'MANAGER_APPROVAL_PENDING',
    );
    expect(pendingStatusForApprover({ approverType: 'DEPARTMENT_HEAD' })).toBe(
      'MANAGER_APPROVAL_PENDING',
    );
  });

  it('falls back to SUBMITTED for a custom role with no dedicated status', () => {
    expect(pendingStatusForApprover({ approverType: 'ROLE', approverRoleKey: 'PROCUREMENT' })).toBe(
      'SUBMITTED',
    );
  });
});

describe('shouldSkipStep', () => {
  it('skips when the estimate is at or below the threshold', () => {
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), '50.00')).toBe(true);
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), '100.00')).toBe(true);
  });

  it('does not skip above the threshold', () => {
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), '100.01')).toBe(false);
  });

  it('never skips a step with no threshold', () => {
    expect(shouldSkipStep(step({ costThreshold: null }), '1')).toBe(false);
  });

  // An unknown cost must reach a human rather than quietly bypassing approval.
  it('never skips when the cost is unknown', () => {
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), null)).toBe(false);
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), undefined)).toBe(false);
  });

  it('never skips on an unparseable figure', () => {
    expect(shouldSkipStep(step({ costThreshold: 'abc' }), '10')).toBe(false);
    expect(shouldSkipStep(step({ costThreshold: '100' }), 'abc')).toBe(false);
  });
});

describe('resolveApplicableSteps', () => {
  const steps = [
    step({ stepOrder: 3, approverRoleKey: 'FINANCE', costThreshold: '500.00' }),
    step({ stepOrder: 1, approverType: 'LINE_MANAGER', approverRoleKey: null }),
    step({ stepOrder: 2, approverRoleKey: 'IT_ADMIN' }),
  ];

  it('returns steps in order', () => {
    expect(resolveApplicableSteps(steps, '1000').map((s) => s.stepOrder)).toEqual([1, 2, 3]);
  });

  it('drops steps below their threshold', () => {
    expect(resolveApplicableSteps(steps, '100').map((s) => s.stepOrder)).toEqual([1, 2]);
  });

  it('does not mutate the input array', () => {
    const original = [...steps];
    resolveApplicableSteps(steps, '100');
    expect(steps).toEqual(original);
  });
});

describe('canApproveStep', () => {
  it('matches a role step against the actor’s roles', () => {
    expect(
      canApproveStep({
        step: step({ approverRoleKey: 'FINANCE' }),
        actorId: 'u1',
        actorRoleKeys: ['FINANCE'],
      }),
    ).toBe(true);

    expect(
      canApproveStep({
        step: step({ approverRoleKey: 'FINANCE' }),
        actorId: 'u1',
        actorRoleKeys: ['IT_ADMIN'],
      }),
    ).toBe(false);
  });

  it('matches a named-user step only against that user', () => {
    const s = step({ approverType: 'USER', approverUserId: 'u9' });
    expect(canApproveStep({ step: s, actorId: 'u9', actorRoleKeys: [] })).toBe(true);
    expect(canApproveStep({ step: s, actorId: 'u1', actorRoleKeys: ['SUPER_ADMIN'] })).toBe(false);
  });

  // The important one: holding a manager role is not the same as being *this*
  // requester's manager.
  it('requires the actual line manager, not merely a manager role', () => {
    const s = step({ approverType: 'LINE_MANAGER' });
    expect(
      canApproveStep({
        step: s,
        actorId: 'mgr',
        actorRoleKeys: ['MANAGER'],
        requesterManagerId: 'mgr',
      }),
    ).toBe(true);
    expect(
      canApproveStep({
        step: s,
        actorId: 'other-mgr',
        actorRoleKeys: ['MANAGER'],
        requesterManagerId: 'mgr',
      }),
    ).toBe(false);
  });

  it('denies a line-manager step when the requester has no manager', () => {
    expect(
      canApproveStep({
        step: step({ approverType: 'LINE_MANAGER' }),
        actorId: 'mgr',
        actorRoleKeys: ['MANAGER'],
        requesterManagerId: null,
      }),
    ).toBe(false);
  });
});
