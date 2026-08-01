import { describe, expect, it } from 'vitest';
import {
  daysUntilExpiry,
  deriveLicenseStatus,
  expiryBucket,
  isHighUtilization,
  resolveAssignmentPrincipal,
  seatLimitMessage,
  seatUtilization,
  seatsAvailable,
  validatePoolAllocations,
} from './license';

const NOW = new Date('2026-08-01T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('deriveLicenseStatus', () => {
  it('is ACTIVE for perpetual licences (no expiry)', () => {
    expect(deriveLicenseStatus(null, NOW)).toBe('ACTIVE');
    expect(deriveLicenseStatus(undefined, NOW)).toBe('ACTIVE');
  });

  it('is ACTIVE while more than the warn window remains', () => {
    expect(deriveLicenseStatus(days(91), NOW)).toBe('ACTIVE');
  });

  it('is EXPIRING inside the 90-day window, inclusive at the boundary', () => {
    expect(deriveLicenseStatus(days(90), NOW)).toBe('EXPIRING');
    expect(deriveLicenseStatus(days(1), NOW)).toBe('EXPIRING');
  });

  it('is EXPIRED once the date has passed', () => {
    expect(deriveLicenseStatus(days(-1), NOW)).toBe('EXPIRED');
  });

  it('RETIRED wins over everything', () => {
    expect(deriveLicenseStatus(days(-1), NOW, true)).toBe('RETIRED');
    expect(deriveLicenseStatus(null, NOW, true)).toBe('RETIRED');
  });
});

describe('expiryBucket', () => {
  it('places an expiry in the tightest bucket that holds it', () => {
    expect(expiryBucket(days(5), NOW)).toBe(30);
    expect(expiryBucket(days(30), NOW)).toBe(30);
    expect(expiryBucket(days(31), NOW)).toBe(60);
    expect(expiryBucket(days(60), NOW)).toBe(60);
    expect(expiryBucket(days(61), NOW)).toBe(90);
    expect(expiryBucket(days(90), NOW)).toBe(90);
  });

  it('is null beyond 90 days and after expiry', () => {
    expect(expiryBucket(days(91), NOW)).toBeNull();
    expect(expiryBucket(days(-1), NOW)).toBeNull();
  });

  it('daysUntilExpiry rounds up and goes negative after the date', () => {
    expect(daysUntilExpiry(days(1), NOW)).toBe(1);
    expect(daysUntilExpiry(days(-2), NOW)).toBe(-2);
  });
});

describe('seat math', () => {
  it('seatsAvailable never goes negative', () => {
    expect(seatsAvailable(10, 4)).toBe(6);
    expect(seatsAvailable(10, 12)).toBe(0);
  });

  it('utilization is clamped and safe on empty pools', () => {
    expect(seatUtilization(10, 9)).toBeCloseTo(0.9);
    expect(seatUtilization(0, 0)).toBe(0);
    expect(seatUtilization(10, 15)).toBe(1);
  });

  it('flags high utilization at 90% and above, never for empty pools', () => {
    expect(isHighUtilization(10, 9)).toBe(true);
    expect(isHighUtilization(10, 8)).toBe(false);
    expect(isHighUtilization(0, 0)).toBe(false);
  });
});

describe('validatePoolAllocations', () => {
  it('accepts allocations that sum to at most the purchase', () => {
    expect(validatePoolAllocations(10, [4, 6])).toEqual({ ok: true, total: 10 });
    expect(validatePoolAllocations(10, [3])).toEqual({ ok: true, total: 3 });
  });

  it('rejects over-allocation with honest numbers', () => {
    const result = validatePoolAllocations(10, [7, 6]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('13');
    expect(result.message).toContain('10');
  });

  it('rejects negative or fractional allocations', () => {
    expect(validatePoolAllocations(10, [-1]).ok).toBe(false);
    expect(validatePoolAllocations(10, [1.5]).ok).toBe(false);
  });
});

describe('resolveAssignmentPrincipal', () => {
  it('requires exactly one principal', () => {
    expect(resolveAssignmentPrincipal('USER', {}).ok).toBe(false);
    expect(resolveAssignmentPrincipal('USER', { userId: 'u', assetId: 'a' }).ok).toBe(false);
  });

  it('matches the principal kind to the licence unit', () => {
    expect(resolveAssignmentPrincipal('USER', { userId: 'u1' })).toEqual({
      ok: true,
      field: 'userId',
      id: 'u1',
    });
    expect(resolveAssignmentPrincipal('DEVICE', { assetId: 'a1' })).toEqual({
      ok: true,
      field: 'assetId',
      id: 'a1',
    });
    expect(resolveAssignmentPrincipal('USER', { assetId: 'a1' }).ok).toBe(false);
    expect(resolveAssignmentPrincipal('DEVICE', { userId: 'u1' }).ok).toBe(false);
  });
});

describe('seatLimitMessage', () => {
  it('reports the honest numbers from the snapshot', () => {
    const message = seatLimitMessage({ purchased: 10, reserved: 10 });
    expect(message).toContain('Available: 0');
    expect(message).toContain('Purchased: 10');
    expect(message).toContain('Assigned: 10');
  });
});
