import { describe, expect, it } from 'vitest';
import { decideRequestCreation } from './request-policy';

/**
 * The rule that decides whether somebody may raise a request. It gates a real
 * action, so every branch is pinned - especially the two that matter most:
 * a per-person block must beat a permissive company, and a per-person allow
 * must beat a restrictive one.
 */

const base = {
  policy: 'EVERYONE' as const,
  override: null,
  hasCreatePermission: true,
  raisesOnBehalf: false,
};

describe('the permission is the floor', () => {
  it('refuses anyone without requests:create, whatever the policy says', () => {
    for (const policy of ['EVERYONE', 'ADMINS_ONLY'] as const) {
      for (const override of [null, true, false]) {
        const d = decideRequestCreation({ ...base, policy, override, hasCreatePermission: false });
        expect(d.allowed).toBe(false);
      }
    }
  });
});

describe('company policy', () => {
  it('lets everyone raise when the policy is EVERYONE', () => {
    expect(decideRequestCreation(base).allowed).toBe(true);
  });

  it('stops an ordinary employee when the policy is ADMINS_ONLY', () => {
    const d = decideRequestCreation({ ...base, policy: 'ADMINS_ONLY' });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/IT and HR/i);
  });

  it('never blocks the people who raise on behalf of others', () => {
    const d = decideRequestCreation({ ...base, policy: 'ADMINS_ONLY', raisesOnBehalf: true });
    expect(d.allowed).toBe(true);
  });
});

describe('per-person overrides win in both directions', () => {
  it('blocks one person even when the company allows everyone', () => {
    const d = decideRequestCreation({ ...base, policy: 'EVERYONE', override: false });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/turned off for your account/i);
  });

  it('allows one person even when the company allows only IT and HR', () => {
    const d = decideRequestCreation({ ...base, policy: 'ADMINS_ONLY', override: true });
    expect(d.allowed).toBe(true);
  });

  it('a block beats on-behalf too - it is about the account, not the job', () => {
    const d = decideRequestCreation({
      ...base,
      policy: 'EVERYONE',
      override: false,
      raisesOnBehalf: true,
    });
    expect(d.allowed).toBe(false);
  });
});

describe('the refusal always says what to do next', () => {
  it('never returns a bare no', () => {
    const refusals = [
      decideRequestCreation({ ...base, hasCreatePermission: false }),
      decideRequestCreation({ ...base, override: false }),
      decideRequestCreation({ ...base, policy: 'ADMINS_ONLY' }),
    ];
    for (const d of refusals) {
      expect(d.allowed).toBe(false);
      expect(d.reason && d.reason.length).toBeGreaterThan(20);
    }
  });
});
