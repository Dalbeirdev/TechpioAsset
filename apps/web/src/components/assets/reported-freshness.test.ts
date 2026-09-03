import { describe, expect, it } from 'vitest';
import { relativeAge } from './reported-freshness';

/**
 * The relative form is the whole point of this component.
 *
 * "26 Aug" reads as a fact and "8 days ago" reads as a problem, and that
 * difference is why twenty-one silent agents went unnoticed for a week. So the
 * phrasing is pinned rather than left to drift.
 */

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('how the age of a report reads', () => {
  it('says "just now" for something that arrived seconds ago', () => {
    expect(relativeAge(ago(30_000))).toBe('just now');
  });

  it('counts in hours through the first day', () => {
    expect(relativeAge(ago(3 * HOUR))).toBe('3 hours ago');
    expect(relativeAge(ago(1 * HOUR))).toBe('1 hour ago');
  });

  it('treats anything under an hour as "just now"', () => {
    // A check-in half an hour ago is current by any useful measure, and
    // "0 hours ago" would read as broken.
    expect(relativeAge(ago(30 * MINUTE))).toBe('just now');
  });

  it('never rounds down to "0 hours ago" just past the boundary', () => {
    expect(relativeAge(ago(61 * MINUTE))).toBe('1 hour ago');
  });

  it('counts in days after that, singular where it should be', () => {
    expect(relativeAge(ago(1 * DAY))).toBe('1 day ago');
    expect(relativeAge(ago(8 * DAY))).toBe('8 days ago');
  });

  it('reports the real age of the fleet that prompted this', () => {
    // The 21 agents that stopped on 26 August. A week later this must read as
    // a number somebody reacts to, not as a date they skim past.
    expect(relativeAge(ago(7 * DAY))).toBe('7 days ago');
  });
});
