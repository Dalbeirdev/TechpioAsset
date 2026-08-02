import { describe, expect, it } from 'vitest';
import { advanceSchedule, shouldEscalateWorkOrder } from './work-order';

const now = new Date('2026-08-02T12:00:00Z');
const past = new Date('2026-08-01T12:00:00Z');
const future = new Date('2026-08-03T12:00:00Z');

describe('shouldEscalateWorkOrder', () => {
  it('escalates an overdue active order', () => {
    for (const status of ['SCHEDULED', 'IN_PROGRESS', 'ON_HOLD'] as const) {
      expect(shouldEscalateWorkOrder({ status, slaDueAt: past, escalatedAt: null }, now)).toBe(true);
    }
  });

  it('escalates exactly once - a prior escalation blocks forever', () => {
    expect(
      shouldEscalateWorkOrder({ status: 'IN_PROGRESS', slaDueAt: past, escalatedAt: past }, now),
    ).toBe(false);
  });

  it('never escalates without an SLA, before the SLA, or after the work ended', () => {
    expect(
      shouldEscalateWorkOrder({ status: 'IN_PROGRESS', slaDueAt: null, escalatedAt: null }, now),
    ).toBe(false);
    expect(
      shouldEscalateWorkOrder({ status: 'IN_PROGRESS', slaDueAt: future, escalatedAt: null }, now),
    ).toBe(false);
    for (const status of ['COMPLETED', 'CANCELLED', 'FAILED', 'REQUESTED'] as const) {
      expect(shouldEscalateWorkOrder({ status, slaDueAt: past, escalatedAt: null }, now)).toBe(
        false,
      );
    }
  });
});

describe('advanceSchedule', () => {
  it('advances one interval when the due date just passed', () => {
    const next = advanceSchedule(new Date('2026-08-02T00:00:00Z'), 7, now);
    expect(next.toISOString()).toBe('2026-08-09T00:00:00.000Z');
  });

  it('catches up over a long outage with ONE future date, not a backlog', () => {
    // Due 2026-01-01, weekly, sweep returns 2026-08-02: lands on the first
    // strictly-future weekly slot.
    const next = advanceSchedule(new Date('2026-01-01T00:00:00Z'), 7, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
    // Still on the original weekly grid.
    expect((next.getTime() - Date.parse('2026-01-01T00:00:00Z')) % (7 * 86_400_000)).toBe(0);
  });

  it('a future due date is left alone', () => {
    const next = advanceSchedule(future, 30, now);
    expect(next.toISOString()).toBe(future.toISOString());
  });

  it('rejects nonsensical intervals', () => {
    expect(() => advanceSchedule(now, 0, now)).toThrow();
    expect(() => advanceSchedule(now, 1.5, now)).toThrow();
  });
});
