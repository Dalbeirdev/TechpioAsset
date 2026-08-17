/**
 * Who may raise a request (v2.22).
 *
 * The permission `requests:create` answers "is this person the kind of user who
 * raises requests" - it belongs to the Registered Employee role and every
 * employee has it. It cannot answer "has the company switched request-raising
 * off this quarter", or "everyone except this one contractor", because system
 * roles are immutable by design and roles are all-or-nothing.
 *
 * So the permission stays as the floor, and this decides on top of it. Kept
 * pure and here rather than inside the service, so the button the employee sees
 * and the rule the server enforces are the same sentence.
 */

export const REQUEST_CREATION_POLICIES = ['EVERYONE', 'ADMINS_ONLY'] as const;
export type RequestCreationPolicy = (typeof REQUEST_CREATION_POLICIES)[number];

export interface RequestPolicyInput {
  /** The company-wide setting. */
  policy: RequestCreationPolicy;
  /** Per-person override: null follows the policy, true allows, false blocks. */
  override: boolean | null | undefined;
  /** Holds requests:create at all - the floor this sits on top of. */
  hasCreatePermission: boolean;
  /**
   * Holds requests:create-on-behalf. HR and IT raise requests for other people
   * as their job, so switching the company policy off must not stop them doing
   * it - otherwise turning it off would stop the process rather than the noise.
   */
  raisesOnBehalf: boolean;
}

export interface RequestPolicyDecision {
  allowed: boolean;
  /** Shown to the person, so it must say what to do next, not just "no". */
  reason?: string;
}

export function decideRequestCreation(input: RequestPolicyInput): RequestPolicyDecision {
  if (!input.hasCreatePermission) {
    return { allowed: false, reason: 'Your role does not include raising requests.' };
  }

  // An explicit decision about one person beats the company default in both
  // directions - that is the entire point of an exception.
  if (input.override === false) {
    return {
      allowed: false,
      reason: 'Raising requests has been turned off for your account. Ask IT or HR to raise one for you.',
    };
  }
  if (input.override === true) return { allowed: true };

  if (input.policy === 'ADMINS_ONLY' && !input.raisesOnBehalf) {
    return {
      allowed: false,
      reason: 'Requests are currently raised by IT and HR only. Contact them and they will raise it for you.',
    };
  }

  return { allowed: true };
}

/** Label for the company setting, in the words an administrator would use. */
export const REQUEST_POLICY_LABELS: Record<RequestCreationPolicy, string> = {
  EVERYONE: 'Everyone can raise requests',
  ADMINS_ONLY: 'Only IT and HR can raise requests',
};

/** Label for the per-person override. */
export const REQUEST_OVERRIDE_LABELS = {
  inherit: 'Follow the company setting',
  allow: 'Always allowed',
  block: 'Blocked from raising requests',
} as const;
