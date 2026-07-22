/**
 * AI feature gating (spec section 10).
 *
 * Pure resolution logic: given a company's configuration and the feature, actor
 * role and office in question, decide whether AI runs and in what mode. Kept out
 * of the service layer and out of I/O so the single most important rule in the
 * spec — "When AI is disabled ... No document should be submitted to an external
 * AI provider" — is a testable function rather than an if-statement someone might
 * get wrong.
 */

export const AI_FEATURES = [
  'INVOICE_OCR',
  'INVOICE_FIELD_EXTRACTION',
  'LINE_ITEM_EXTRACTION',
  'CATEGORY_SUGGESTION',
  'VENDOR_SUGGESTION',
  'INVOICE_TO_ASSET_MATCHING',
  'DUPLICATE_WARNING',
  'WARRANTY_EXTRACTION',
  'DRAFT_ASSET_CREATION',
  'AI_SUMMARIES',
  'AI_ASSISTANT',
  'SEMANTIC_SEARCH',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_MODES = [
  'DISABLED',
  'SUGGESTION_ONLY',
  'MANUAL_REVIEW_REQUIRED',
  'AUTOMATIC_PROCESSING',
  'RESTRICTED_TO_ROLES',
] as const;
export type AiFeatureMode = (typeof AI_FEATURE_MODES)[number];

export interface AiConfigState {
  globallyEnabled: boolean;
  pausedAt: Date | null;
  /** Map of feature -> mode. */
  featureModes: Partial<Record<AiFeature, AiFeatureMode>>;
  confidenceThreshold: number;
  /** Spec section 10 default: AI never finalises money on its own. */
  automaticFinancialApproval: boolean;
  humanReviewRequired: boolean;
}

/** A narrowing override for a feature, scoped to an office and/or role. */
export interface AiFeatureOverride {
  feature: AiFeature;
  mode: AiFeatureMode;
  officeId: string | null;
  roleKey: string | null;
}

export interface AiGateQuery {
  feature: AiFeature;
  officeId?: string | null;
  roleKeys?: readonly string[];
}

export interface AiGateResult {
  /** Whether the feature runs at all. When false, no provider may be called. */
  enabled: boolean;
  mode: AiFeatureMode;
  /** Whether a human must confirm before the result takes effect. */
  requiresHumanReview: boolean;
  /** Why it is off, for the UI to explain rather than silently hide the feature. */
  reason?: 'GLOBALLY_DISABLED' | 'PAUSED' | 'FEATURE_DISABLED' | 'ROLE_NOT_PERMITTED';
}

/**
 * The single decision point. Every place that might call an AI provider must ask
 * this first; nothing calls a provider without an `enabled: true` result.
 */
export function resolveAiGate(
  config: AiConfigState,
  overrides: readonly AiFeatureOverride[],
  query: AiGateQuery,
): AiGateResult {
  if (!config.globallyEnabled) {
    return {
      enabled: false,
      mode: 'DISABLED',
      requiresHumanReview: true,
      reason: 'GLOBALLY_DISABLED',
    };
  }
  if (config.pausedAt) {
    return { enabled: false, mode: 'DISABLED', requiresHumanReview: true, reason: 'PAUSED' };
  }

  // The most specific applicable override wins: office+role, then office, then
  // role, then the company-wide feature mode.
  const mode = resolveMode(config, overrides, query);

  if (mode === 'DISABLED') {
    return { enabled: false, mode, requiresHumanReview: true, reason: 'FEATURE_DISABLED' };
  }

  if (mode === 'RESTRICTED_TO_ROLES') {
    // Restricted with no matching override means this actor is not on the list.
    const permitted = overrides.some(
      (o) =>
        o.feature === query.feature &&
        o.mode !== 'DISABLED' &&
        o.roleKey !== null &&
        (query.roleKeys ?? []).includes(o.roleKey),
    );
    if (!permitted) {
      return { enabled: false, mode, requiresHumanReview: true, reason: 'ROLE_NOT_PERMITTED' };
    }
  }

  // Human review is required unless the feature is explicitly AUTOMATIC *and* the
  // company has not globally mandated review. Financial finalisation ignores this
  // entirely — see mayAutoApproveFinancials.
  const requiresHumanReview =
    config.humanReviewRequired || mode === 'MANUAL_REVIEW_REQUIRED' || mode === 'SUGGESTION_ONLY';

  return { enabled: true, mode, requiresHumanReview };
}

function resolveMode(
  config: AiConfigState,
  overrides: readonly AiFeatureOverride[],
  query: AiGateQuery,
): AiFeatureMode {
  const applicable = overrides.filter((o) => o.feature === query.feature);

  const officeAndRole = applicable.find(
    (o) =>
      o.officeId === query.officeId &&
      o.roleKey !== null &&
      (query.roleKeys ?? []).includes(o.roleKey),
  );
  if (officeAndRole) return officeAndRole.mode;

  const officeOnly = applicable.find((o) => o.officeId === query.officeId && o.roleKey === null);
  if (officeOnly) return officeOnly.mode;

  const roleOnly = applicable.find(
    (o) => o.officeId === null && o.roleKey !== null && (query.roleKeys ?? []).includes(o.roleKey),
  );
  if (roleOnly) return roleOnly.mode;

  return config.featureModes[query.feature] ?? 'DISABLED';
}

/**
 * Spec section 10: "Do not allow AI to make final financial approvals
 * automatically." This is unconditional — no configuration can turn it on for
 * invoice verification. The AI configuration's automaticFinancialApproval flag
 * governs *non-verification* automation only, and even it defaults off.
 */
export function mayAutoApproveFinancials(): boolean {
  return false;
}

/** A value is low-confidence when it falls below the configured threshold. */
export function isLowConfidence(confidence: number, threshold: number): boolean {
  return confidence < threshold;
}
