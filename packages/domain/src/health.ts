/**
 * Asset health score — v2.5 (blueprint B.7, implemented as a contract).
 *
 * Six weighted sub-scores; unknown dimensions are EXCLUDED and the remaining
 * weights renormalised (a desktop without a battery is not penalised for it).
 * The capping rule dominates: if Security or Storage scores below 40 (an
 * unencrypted disk, failing SMART), the overall grade cannot exceed POOR
 * regardless of the weighted average — safety-critical dimensions win.
 *
 * B.7's table gives example bands with gaps; the gap-filling here is
 * deterministic and documented inline rather than improvised per call.
 */

export const HEALTH_WEIGHTS = {
  battery: 0.15,
  storage: 0.2,
  memory: 0.1,
  warranty: 0.15,
  security: 0.25,
  updates: 0.15,
} as const;
export type HealthDimension = keyof typeof HEALTH_WEIGHTS;

export const HEALTH_GRADES = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL'] as const;
export type HealthGrade = (typeof HEALTH_GRADES)[number];

/** 90–100 Excellent · 75–89 Good · 60–74 Fair · 40–59 Poor · <40 Critical. */
export function healthGrade(overall: number): HealthGrade {
  if (overall >= 90) return 'EXCELLENT';
  if (overall >= 75) return 'GOOD';
  if (overall >= 60) return 'FAIR';
  if (overall >= 40) return 'POOR';
  return 'CRITICAL';
}

/** The score at which a safety-critical dimension triggers the cap. */
export const CAP_TRIGGER = 40;
/** POOR's ceiling — the capped overall can never reach FAIR. */
export const CAP_CEILING = 59;

export interface HealthInputs {
  battery?: { healthPct: number; cycleCount: number } | null;
  storage?: { smart: 'HEALTHY' | 'WARNING' | 'FAILING'; freePct: number } | null;
  memory?: { ramGb: number; baselineGb: number } | null;
  warranty?: { daysRemaining: number | null } | null;
  security?: {
    diskEncrypted: boolean;
    defenderEnabled: boolean;
    firewallEnabled: boolean;
    tpmPresent: boolean;
    osActivated: boolean;
    localAdminCount: number;
  } | null;
  updates?: { missingCriticalPatches: number; osSupported: boolean } | null;
}

export interface SubScore {
  key: HealthDimension;
  score: number;
  weight: number;
}

export interface HealthResult {
  overall: number;
  grade: HealthGrade;
  capped: boolean;
  subScores: SubScore[];
  recommendations: string[];
}

/** ≥80% & <500 cycles = 100 · 60–79% = 70 · 50–59% = 50 (gap fill) · <50% or >1000 cycles = 30. */
export function scoreBattery(input: NonNullable<HealthInputs['battery']>): number {
  if (input.healthPct < 50 || input.cycleCount > 1000) return 30;
  if (input.healthPct >= 80 && input.cycleCount < 500) return 100;
  if (input.healthPct >= 80) return 70; // healthy cells, heavy cycling (gap fill)
  if (input.healthPct >= 60) return 70;
  return 50;
}

/** SMART healthy & >20% free = 100 · 10–20% free = 70 (gap fill) · <10% = 50 · WARNING = 40 · FAILING = 0. */
export function scoreStorage(input: NonNullable<HealthInputs['storage']>): number {
  if (input.smart === 'FAILING') return 0;
  if (input.smart === 'WARNING') return 40;
  if (input.freePct > 20) return 100;
  if (input.freePct >= 10) return 70;
  return 50;
}

/** Meets the role baseline = 100 · below = 50. */
export function scoreMemory(input: NonNullable<HealthInputs['memory']>): number {
  return input.ramGb >= input.baselineGb ? 100 : 50;
}

/** >180d = 100 · 90–180 = 75 · 30–89 = 50 · <30 = 25 · expired (or none) = 0. */
export function scoreWarranty(input: NonNullable<HealthInputs['warranty']>): number {
  const days = input.daysRemaining;
  if (days === null || days < 0) return 0;
  if (days > 180) return 100;
  if (days >= 90) return 75;
  if (days >= 30) return 50;
  return 25;
}

/** All controls on = 100; each disabled control −20; unencrypted disk caps the sub-score at 40. */
export function scoreSecurity(input: NonNullable<HealthInputs['security']>): number {
  let score = 100;
  if (!input.diskEncrypted) score -= 20;
  if (!input.defenderEnabled) score -= 20;
  if (!input.firewallEnabled) score -= 20;
  if (!input.tpmPresent) score -= 20;
  if (!input.osActivated) score -= 20;
  if (input.localAdminCount > 1) score -= 20; // more than the one break-glass admin
  score = Math.max(0, score);
  if (!input.diskEncrypted) score = Math.min(score, 40);
  return score;
}

/** Fully patched = 100; each missing critical −10 (floor 0); unsupported OS caps at 30. */
export function scoreUpdates(input: NonNullable<HealthInputs['updates']>): number {
  let score = Math.max(0, 100 - input.missingCriticalPatches * 10);
  if (!input.osSupported) score = Math.min(score, 30);
  return score;
}

const SCORERS: { [K in HealthDimension]: (input: never) => number } = {
  battery: scoreBattery,
  storage: scoreStorage,
  memory: scoreMemory,
  warranty: scoreWarranty,
  security: scoreSecurity,
  updates: scoreUpdates,
};

/** The overall score: known dimensions only, weights renormalised, cap applied. */
export function computeHealth(inputs: HealthInputs): HealthResult | null {
  const subScores: SubScore[] = [];
  for (const key of Object.keys(HEALTH_WEIGHTS) as HealthDimension[]) {
    const input = inputs[key];
    if (input === undefined || input === null) continue;
    subScores.push({ key, score: SCORERS[key](input as never), weight: HEALTH_WEIGHTS[key] });
  }
  if (subScores.length === 0) return null; // nothing known - no score, no lie

  const totalWeight = subScores.reduce((sum, s) => sum + s.weight, 0);
  const weighted = subScores.reduce((sum, s) => sum + s.score * (s.weight / totalWeight), 0);
  let overall = Math.round(weighted);

  const capTriggered = subScores.some(
    (s) => (s.key === 'security' || s.key === 'storage') && s.score < CAP_TRIGGER,
  );
  const capped = capTriggered && overall > CAP_CEILING;
  if (capped) overall = CAP_CEILING;

  return {
    overall,
    grade: healthGrade(overall),
    capped,
    subScores,
    recommendations: recommend(inputs, subScores),
  };
}

/** Actionable strings for the Health tab — plain words, worst first. */
export function recommend(inputs: HealthInputs, subScores: readonly SubScore[]): string[] {
  const out: string[] = [];
  const score = (key: HealthDimension) => subScores.find((s) => s.key === key)?.score;

  if (inputs.storage?.smart === 'FAILING') {
    out.push('Replace the drive now — SMART reports it as failing. Back up first.');
  } else if (inputs.storage?.smart === 'WARNING') {
    out.push('The drive reports SMART warnings — schedule a replacement.');
  } else if (inputs.storage && inputs.storage.freePct < 10) {
    out.push('Free up disk space — less than 10% remains.');
  }
  if (inputs.security && !inputs.security.diskEncrypted) {
    out.push('Enable disk encryption — an unencrypted disk caps this asset at Poor.');
  }
  if (inputs.security && !inputs.security.defenderEnabled) out.push('Turn the antivirus back on.');
  if (inputs.security && !inputs.security.firewallEnabled) out.push('Turn the firewall back on.');
  if (inputs.security && inputs.security.localAdminCount > 1) {
    out.push('Reduce local administrator accounts to one.');
  }
  if (inputs.updates && inputs.updates.missingCriticalPatches > 0) {
    out.push(`Install ${inputs.updates.missingCriticalPatches} missing critical update(s).`);
  }
  if (inputs.updates && !inputs.updates.osSupported) {
    out.push('The operating system is out of support — plan an upgrade or replacement.');
  }
  if ((score('battery') ?? 100) <= 30) {
    out.push('The battery is worn out — replace it or plan a device refresh.');
  }
  if ((score('warranty') ?? 100) <= 25) {
    out.push('Warranty cover is ending or gone — review renewal or replacement.');
  }
  if ((score('memory') ?? 100) < 100) {
    out.push('Memory is below the role baseline — consider an upgrade.');
  }
  return out;
}
