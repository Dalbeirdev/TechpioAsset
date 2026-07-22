import { describe, it, expect } from 'vitest';
import { parseCron, nextCronRun } from './cron.js';

describe('parseCron', () => {
  it('accepts a valid 5-field expression', () => {
    expect(parseCron('0 9 * * 1')).not.toBeNull();
  });

  it('rejects the wrong number of fields', () => {
    expect(parseCron('0 9 * *')).toBeNull();
    expect(parseCron('0 9 * * 1 6')).toBeNull();
  });
});

describe('nextCronRun', () => {
  it('finds the next daily 09:00', () => {
    const from = new Date('2026-07-01T08:00:00');
    const next = nextCronRun('0 9 * * *', from);
    expect(next?.getHours()).toBe(9);
    expect(next?.getMinutes()).toBe(0);
    expect(next?.getDate()).toBe(1);
  });

  it('rolls to the next day when today’s time has passed', () => {
    const from = new Date('2026-07-01T10:00:00');
    const next = nextCronRun('0 9 * * *', from);
    expect(next?.getDate()).toBe(2);
  });

  it('finds the next Monday for a weekday schedule', () => {
    // 2026-07-01 is a Wednesday; next Monday is the 6th.
    const next = nextCronRun('0 9 * * 1', new Date('2026-07-01T00:00:00'));
    expect(next?.getDay()).toBe(1);
    expect(next?.getDate()).toBe(6);
  });

  it('handles a step expression (every 15 minutes)', () => {
    const from = new Date('2026-07-01T10:07:00');
    const next = nextCronRun('*/15 * * * *', from);
    expect(next?.getMinutes()).toBe(15);
  });

  it('returns null for an invalid expression', () => {
    expect(nextCronRun('nonsense', new Date())).toBeNull();
  });
});
