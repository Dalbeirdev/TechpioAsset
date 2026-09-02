import { describe, expect, it } from 'vitest';
import { personInitials } from './person-avatar';

/**
 * The avatar stands in for a photograph on every list of people, so the two
 * things it must never do are show the wrong letters and show everyone the
 * same. Both are silent failures: a wall of identical circles looks like a
 * design choice rather than a bug.
 */

describe('initials for a person', () => {
  it('takes the first and last name', () => {
    expect(personInitials('Sushmita Sharma')).toBe('SS');
    expect(personInitials('Harry Singh')).toBe('HS');
  });

  it('skips middle names rather than running out of room', () => {
    // Three initials in a 28px circle is unreadable, and the surname is the
    // half people actually recognise.
    expect(personInitials('Anil Kumar Modalavalasa')).toBe('AM');
  });

  it('handles a single name', () => {
    expect(personInitials('Prince')).toBe('PR');
  });

  it('copes with the spacing real data arrives with', () => {
    expect(personInitials('  Akshay   Thakur  ')).toBe('AT');
  });

  it('falls back to the email when there is no name yet', () => {
    // Imported records routinely have an address and nothing else.
    expect(personInitials(null, 'jeevan@techpio.com')).toBe('J');
    expect(personInitials('', 'a@b.c')).toBe('A');
  });

  it('never renders empty', () => {
    // An empty circle reads as a broken image; "?" reads as unknown, which is
    // the truth.
    expect(personInitials(null)).toBe('?');
    expect(personInitials('   ', null)).toBe('?');
  });

  it('is case-insensitive about what it is given', () => {
    expect(personInitials('akshay thakur')).toBe('AT');
    expect(personInitials('AKSHAY THAKUR')).toBe('AT');
  });
});
