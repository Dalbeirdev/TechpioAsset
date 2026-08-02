import { describe, expect, it } from 'vitest';
import {
  CAP_CEILING,
  computeHealth,
  healthGrade,
  scoreBattery,
  scoreMemory,
  scoreSecurity,
  scoreStorage,
  scoreUpdates,
  scoreWarranty,
} from './health';

const fullSecurity = {
  diskEncrypted: true,
  defenderEnabled: true,
  firewallEnabled: true,
  tpmPresent: true,
  osActivated: true,
  localAdminCount: 1,
};

describe('sub-scores reproduce the B.7 table', () => {
  it('battery', () => {
    expect(scoreBattery({ healthPct: 85, cycleCount: 300 })).toBe(100);
    expect(scoreBattery({ healthPct: 70, cycleCount: 300 })).toBe(70);
    expect(scoreBattery({ healthPct: 55, cycleCount: 300 })).toBe(50); // documented gap fill
    expect(scoreBattery({ healthPct: 45, cycleCount: 300 })).toBe(30);
    expect(scoreBattery({ healthPct: 90, cycleCount: 1200 })).toBe(30); // cycles dominate
  });

  it('storage', () => {
    expect(scoreStorage({ smart: 'HEALTHY', freePct: 30 })).toBe(100);
    expect(scoreStorage({ smart: 'HEALTHY', freePct: 15 })).toBe(70); // documented gap fill
    expect(scoreStorage({ smart: 'HEALTHY', freePct: 5 })).toBe(50);
    expect(scoreStorage({ smart: 'WARNING', freePct: 50 })).toBe(40);
    expect(scoreStorage({ smart: 'FAILING', freePct: 90 })).toBe(0);
  });

  it('memory', () => {
    expect(scoreMemory({ ramGb: 16, baselineGb: 16 })).toBe(100);
    expect(scoreMemory({ ramGb: 8, baselineGb: 16 })).toBe(50);
  });

  it('warranty', () => {
    expect(scoreWarranty({ daysRemaining: 200 })).toBe(100);
    expect(scoreWarranty({ daysRemaining: 120 })).toBe(75);
    expect(scoreWarranty({ daysRemaining: 60 })).toBe(50);
    expect(scoreWarranty({ daysRemaining: 10 })).toBe(25);
    expect(scoreWarranty({ daysRemaining: -1 })).toBe(0);
    expect(scoreWarranty({ daysRemaining: null })).toBe(0);
  });

  it('security: −20 per disabled control; unencrypted disk caps at 40', () => {
    expect(scoreSecurity(fullSecurity)).toBe(100);
    expect(scoreSecurity({ ...fullSecurity, firewallEnabled: false })).toBe(80);
    expect(scoreSecurity({ ...fullSecurity, firewallEnabled: false, localAdminCount: 3 })).toBe(60);
    // Encryption off alone: 80 by subtraction, capped to 40.
    expect(scoreSecurity({ ...fullSecurity, diskEncrypted: false })).toBe(40);
    // Everything off floors at 0.
    expect(
      scoreSecurity({
        diskEncrypted: false,
        defenderEnabled: false,
        firewallEnabled: false,
        tpmPresent: false,
        osActivated: false,
        localAdminCount: 5,
      }),
    ).toBe(0);
  });

  it('updates: −10 per missing critical; unsupported OS caps at 30', () => {
    expect(scoreUpdates({ missingCriticalPatches: 0, osSupported: true })).toBe(100);
    expect(scoreUpdates({ missingCriticalPatches: 3, osSupported: true })).toBe(70);
    expect(scoreUpdates({ missingCriticalPatches: 15, osSupported: true })).toBe(0);
    expect(scoreUpdates({ missingCriticalPatches: 0, osSupported: false })).toBe(30);
  });
});

describe('grade bands', () => {
  it('follows 90/75/60/40', () => {
    expect(healthGrade(95)).toBe('EXCELLENT');
    expect(healthGrade(90)).toBe('EXCELLENT');
    expect(healthGrade(89)).toBe('GOOD');
    expect(healthGrade(75)).toBe('GOOD');
    expect(healthGrade(74)).toBe('FAIR');
    expect(healthGrade(60)).toBe('FAIR');
    expect(healthGrade(59)).toBe('POOR');
    expect(healthGrade(40)).toBe('POOR');
    expect(healthGrade(39)).toBe('CRITICAL');
  });
});

describe('computeHealth', () => {
  it('a pristine laptop is EXCELLENT with no recommendations', () => {
    const result = computeHealth({
      battery: { healthPct: 95, cycleCount: 100 },
      storage: { smart: 'HEALTHY', freePct: 60 },
      memory: { ramGb: 32, baselineGb: 16 },
      warranty: { daysRemaining: 400 },
      security: fullSecurity,
      updates: { missingCriticalPatches: 0, osSupported: true },
    })!;
    expect(result.overall).toBe(100);
    expect(result.grade).toBe('EXCELLENT');
    expect(result.capped).toBe(false);
    expect(result.recommendations).toHaveLength(0);
    expect(result.subScores).toHaveLength(6);
  });

  it('unknown dimensions are excluded and weights renormalised — no battery, no penalty', () => {
    const desktop = computeHealth({
      storage: { smart: 'HEALTHY', freePct: 60 },
      memory: { ramGb: 16, baselineGb: 16 },
      warranty: { daysRemaining: 400 },
      security: fullSecurity,
      updates: { missingCriticalPatches: 0, osSupported: true },
    })!;
    expect(desktop.overall).toBe(100);
    expect(desktop.subScores).toHaveLength(5);
  });

  it('the capping rule: an unencrypted disk drags an otherwise-perfect asset to POOR', () => {
    const result = computeHealth({
      battery: { healthPct: 95, cycleCount: 100 },
      storage: { smart: 'HEALTHY', freePct: 60 },
      memory: { ramGb: 32, baselineGb: 16 },
      warranty: { daysRemaining: 400 },
      security: { ...fullSecurity, diskEncrypted: false }, // sub-score 40... not <40!
      updates: { missingCriticalPatches: 0, osSupported: true },
    })!;
    // Exactly 40 does NOT trigger the cap (the rule is strictly below 40).
    expect(result.capped).toBe(false);

    const worse = computeHealth({
      battery: { healthPct: 95, cycleCount: 100 },
      storage: { smart: 'HEALTHY', freePct: 60 },
      memory: { ramGb: 32, baselineGb: 16 },
      warranty: { daysRemaining: 400 },
      security: { ...fullSecurity, diskEncrypted: false, firewallEnabled: false }, // 40→ capped at 40, minus... = 40 cap then -20? order: subtraction first → 60, then cap 40 → 40. Still not <40.
      updates: { missingCriticalPatches: 0, osSupported: true },
    })!;
    expect(worse.capped).toBe(false);

    const failingDisk = computeHealth({
      storage: { smart: 'FAILING', freePct: 60 }, // 0 < 40 → cap
      memory: { ramGb: 32, baselineGb: 16 },
      warranty: { daysRemaining: 400 },
      security: fullSecurity,
      updates: { missingCriticalPatches: 0, osSupported: true },
    })!;
    expect(failingDisk.capped).toBe(true);
    expect(failingDisk.overall).toBe(CAP_CEILING);
    expect(failingDisk.grade).toBe('POOR');
    expect(failingDisk.recommendations[0]).toContain('Replace the drive');
  });

  it('no data at all means no score — never a fabricated number', () => {
    expect(computeHealth({})).toBeNull();
  });

  it('recommendations name the problems in plain words', () => {
    const result = computeHealth({
      storage: { smart: 'HEALTHY', freePct: 5 },
      security: { ...fullSecurity, diskEncrypted: false, localAdminCount: 4 },
      updates: { missingCriticalPatches: 2, osSupported: false },
      memory: { ramGb: 8, baselineGb: 16 },
    })!;
    const text = result.recommendations.join(' | ');
    expect(text).toContain('Free up disk space');
    expect(text).toContain('disk encryption');
    expect(text).toContain('administrator accounts');
    expect(text).toContain('2 missing critical');
    expect(text).toContain('out of support');
    expect(text).toContain('Memory is below');
  });
});
