import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  agingDistribution,
  cycleStats,
  daysBetween,
  lastMonths,
  median,
  monthKey,
  percentile,
  ratePct,
  utilizationPct,
} from './analytics';

describe('daysBetween', () => {
  it('floors whole days and signs correctly', () => {
    expect(daysBetween(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-03T23:00:00Z'))).toBe(2);
    expect(daysBetween(new Date('2026-08-03T00:00:00Z'), new Date('2026-08-01T00:00:00Z'))).toBe(-2);
  });
});

describe('median and percentile', () => {
  it('handles odd, even and empty lists honestly', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull(); // no data, no fabricated zero
  });

  it('nearest-rank percentile', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([], 90)).toBeNull();
    expect(() => percentile([1], 101)).toThrow();
  });
});

describe('cycleStats', () => {
  it('summarises durations', () => {
    const stats = cycleStats([1, 2, 3, 10]);
    expect(stats.count).toBe(4);
    expect(stats.avgDays).toBe(4);
    expect(stats.medianDays).toBe(2.5);
    expect(stats.p90Days).toBe(10);
  });

  it('the empty set reports nulls, never zeros pretending to be fast', () => {
    expect(cycleStats([])).toEqual({ count: 0, avgDays: null, medianDays: null, p90Days: null });
  });
});

describe('aging buckets', () => {
  it('bucket boundaries are inclusive at 7/30/90', () => {
    expect(agingBucket(0)).toBe('0-7');
    expect(agingBucket(7)).toBe('0-7');
    expect(agingBucket(8)).toBe('8-30');
    expect(agingBucket(30)).toBe('8-30');
    expect(agingBucket(31)).toBe('31-90');
    expect(agingBucket(90)).toBe('31-90');
    expect(agingBucket(91)).toBe('90+');
  });

  it('distribution keeps zero buckets present for stable charts', () => {
    expect(agingDistribution([1, 9, 100])).toEqual({ '0-7': 1, '8-30': 1, '31-90': 0, '90+': 1 });
    expect(agingDistribution([])).toEqual({ '0-7': 0, '8-30': 0, '31-90': 0, '90+': 0 });
  });
});

describe('ratios', () => {
  it('utilization and rates return null on empty denominators', () => {
    expect(utilizationPct(3, 10)).toBe(30);
    expect(utilizationPct(0, 0)).toBeNull();
    expect(ratePct(1, 4)).toBe(25);
    expect(ratePct(0, 0)).toBeNull();
  });
});

describe('month series', () => {
  it('monthKey is UTC-stable', () => {
    expect(monthKey(new Date('2026-08-02T23:59:00Z'))).toBe('2026-08');
  });

  it('lastMonths spans year boundaries oldest-first with no gaps', () => {
    expect(lastMonths(new Date('2026-02-15T00:00:00Z'), 4)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(lastMonths(new Date('2026-02-15T00:00:00Z'), 0)).toEqual([]);
  });
});
