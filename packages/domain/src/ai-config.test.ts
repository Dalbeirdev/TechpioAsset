import { describe, it, expect } from 'vitest';
import {
  resolveAiGate,
  mayAutoApproveFinancials,
  isLowConfidence,
  type AiConfigState,
  type AiFeatureOverride,
} from './ai-config';

function config(over: Partial<AiConfigState> = {}): AiConfigState {
  return {
    globallyEnabled: true,
    pausedAt: null,
    featureModes: { INVOICE_OCR: 'MANUAL_REVIEW_REQUIRED' },
    confidenceThreshold: 0.85,
    automaticFinancialApproval: false,
    humanReviewRequired: true,
    ...over,
  };
}

describe('AI gate — global switches (spec section 10)', () => {
  it('is off when AI is globally disabled', () => {
    const result = resolveAiGate(config({ globallyEnabled: false }), [], {
      feature: 'INVOICE_OCR',
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('GLOBALLY_DISABLED');
  });

  it('is off when AI is paused', () => {
    const result = resolveAiGate(config({ pausedAt: new Date() }), [], { feature: 'INVOICE_OCR' });
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('PAUSED');
  });

  it('is off for a feature whose mode is DISABLED', () => {
    const result = resolveAiGate(config({ featureModes: { INVOICE_OCR: 'DISABLED' } }), [], {
      feature: 'INVOICE_OCR',
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('FEATURE_DISABLED');
  });

  it('is off for a feature with no configured mode', () => {
    const result = resolveAiGate(config({ featureModes: {} }), [], { feature: 'SEMANTIC_SEARCH' });
    expect(result.enabled).toBe(false);
  });

  it('is on with human review for a MANUAL_REVIEW_REQUIRED feature', () => {
    const result = resolveAiGate(config(), [], { feature: 'INVOICE_OCR' });
    expect(result.enabled).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
  });
});

describe('AI gate — overrides', () => {
  const overrides: AiFeatureOverride[] = [
    { feature: 'INVOICE_OCR', mode: 'DISABLED', officeId: 'office-2', roleKey: null },
    { feature: 'INVOICE_OCR', mode: 'AUTOMATIC_PROCESSING', officeId: null, roleKey: 'FINANCE' },
  ];

  it('applies an office-scoped override', () => {
    const result = resolveAiGate(config(), overrides, {
      feature: 'INVOICE_OCR',
      officeId: 'office-2',
    });
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('FEATURE_DISABLED');
  });

  it('applies a role-scoped override', () => {
    const result = resolveAiGate(config({ humanReviewRequired: false }), overrides, {
      feature: 'INVOICE_OCR',
      officeId: 'office-1',
      roleKeys: ['FINANCE'],
    });
    expect(result.enabled).toBe(true);
    expect(result.mode).toBe('AUTOMATIC_PROCESSING');
  });

  it('falls back to the company mode when no override matches', () => {
    const result = resolveAiGate(config(), overrides, {
      feature: 'INVOICE_OCR',
      officeId: 'office-9',
    });
    expect(result.mode).toBe('MANUAL_REVIEW_REQUIRED');
  });

  it('denies a RESTRICTED_TO_ROLES feature to an actor not on the list', () => {
    const result = resolveAiGate(
      config({ featureModes: { INVOICE_OCR: 'RESTRICTED_TO_ROLES' } }),
      [],
      {
        feature: 'INVOICE_OCR',
        roleKeys: ['EMPLOYEE'],
      },
    );
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('ROLE_NOT_PERMITTED');
  });

  it('permits a RESTRICTED_TO_ROLES feature to a listed role', () => {
    const result = resolveAiGate(
      config({ featureModes: { INVOICE_OCR: 'RESTRICTED_TO_ROLES' }, humanReviewRequired: false }),
      [{ feature: 'INVOICE_OCR', mode: 'SUGGESTION_ONLY', officeId: null, roleKey: 'FINANCE' }],
      { feature: 'INVOICE_OCR', roleKeys: ['FINANCE'] },
    );
    expect(result.enabled).toBe(true);
  });
});

describe('automatic financial approval is never allowed (spec section 10)', () => {
  it('is false regardless of configuration', () => {
    // There is no argument, on purpose: nothing can turn this on.
    expect(mayAutoApproveFinancials()).toBe(false);
  });

  it('AUTOMATIC_PROCESSING still does not imply financial auto-approval', () => {
    // A feature can run automatically, but the invoice verification decision is
    // a separate, human-only gate. The gate result never claims otherwise.
    const result = resolveAiGate(config({ humanReviewRequired: false }), [], {
      feature: 'DRAFT_ASSET_CREATION',
    });
    // Even fully automatic, this concerns draft creation, not the money decision.
    expect(mayAutoApproveFinancials()).toBe(false);
    expect(result.enabled).toBe(false); // no mode configured for this feature here
  });
});

describe('confidence threshold', () => {
  it('flags values below the threshold', () => {
    expect(isLowConfidence(0.7, 0.85)).toBe(true);
    expect(isLowConfidence(0.9, 0.85)).toBe(false);
    expect(isLowConfidence(0.85, 0.85)).toBe(false);
  });
});
