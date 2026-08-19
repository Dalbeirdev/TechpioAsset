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
  it('skips only when the estimate is strictly below the threshold', () => {
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), '50.00')).toBe(true);
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), '99.99')).toBe(true);
  });

  // Blueprint BR-05: the threshold is inclusive — equality still needs the step.
  it('does not skip at or above the threshold', () => {
    expect(shouldSkipStep(step({ costThreshold: '100.00' }), '100.00')).toBe(false);
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

  // v2.24 - with no line manager recorded, the Manager ROLE stands in. The
  // old rule (deny outright) left every request from a manager-less profile
  // stalled forever; found in production, where no profile had one.
  it('falls back to the Manager role when the requester has no manager', () => {
    expect(
      canApproveStep({
        step: step({ approverType: 'LINE_MANAGER' }),
        actorId: 'mgr',
        actorRoleKeys: ['MANAGER'],
        requesterManagerId: null,
      }),
    ).toBe(true);
  });

  it('the fallback is only for Manager-role holders', () => {
    expect(
      canApproveStep({
        step: step({ approverType: 'LINE_MANAGER' }),
        actorId: 'someone',
        actorRoleKeys: ['HR', 'FINANCE'],
        requesterManagerId: null,
      }),
    ).toBe(false);
  });

  it('a recorded line manager keeps exclusive claim - the role does not override it', () => {
    expect(
      canApproveStep({
        step: step({ approverType: 'LINE_MANAGER' }),
        actorId: 'other-manager',
        actorRoleKeys: ['MANAGER'],
        requesterManagerId: 'the-real-manager',
      }),
    ).toBe(false);
  });

  // v2.2 Workstream D — a DEPARTMENT_HEAD step is satisfied by the requester's
  // actual department head, resolved from Department.headId.
  it('requires the actual department head for a DEPARTMENT_HEAD step', () => {
    const s = step({ approverType: 'DEPARTMENT_HEAD' });
    expect(
      canApproveStep({ step: s, actorId: 'head', actorRoleKeys: [], requesterDepartmentHeadId: 'head' }),
    ).toBe(true);
    expect(
      canApproveStep({ step: s, actorId: 'other', actorRoleKeys: [], requesterDepartmentHeadId: 'head' }),
    ).toBe(false);
    expect(
      canApproveStep({ step: s, actorId: 'head', actorRoleKeys: [], requesterDepartmentHeadId: null }),
    ).toBe(false);
  });

  // v2.2 Workstream D — segregation of duties (BR-04, APR-009).
  it('forbids the requester from approving their own request, even with the approver role', () => {
    // A ROLE step the requester happens to hold — SoD must still block them.
    expect(
      canApproveStep({
        step: step({ approverRoleKey: 'FINANCE' }),
        actorId: 'u1',
        actorRoleKeys: ['FINANCE'],
        requesterId: 'u1',
      }),
    ).toBe(false);
    // A USER step naming the requester themselves — still blocked.
    expect(
      canApproveStep({
        step: step({ approverType: 'USER', approverUserId: 'u1' }),
        actorId: 'u1',
        actorRoleKeys: [],
        requesterId: 'u1',
      }),
    ).toBe(false);
    // A different eligible approver is unaffected by SoD.
    expect(
      canApproveStep({
        step: step({ approverRoleKey: 'FINANCE' }),
        actorId: 'u2',
        actorRoleKeys: ['FINANCE'],
        requesterId: 'u1',
      }),
    ).toBe(true);
  });
});
