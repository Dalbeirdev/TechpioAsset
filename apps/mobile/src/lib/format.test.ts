import { describe, it, expect } from 'vitest';
import { personName, formatMoney } from './format';

describe('personName', () => {
  it('joins first and last name', () => {
    expect(
      personName({ email: 'a@b.com', profile: { firstName: 'Aanya', lastName: 'Sharma' } }),
    ).toBe('Aanya Sharma');
  });

  it('falls back to email when the profile is missing or empty', () => {
    expect(personName({ email: 'a@b.com', profile: null })).toBe('a@b.com');
    expect(personName({ email: 'a@b.com', profile: { firstName: null, lastName: null } })).toBe(
      'a@b.com',
    );
  });

  it('handles a single name part', () => {
    expect(personName({ email: 'a@b.com', profile: { firstName: 'Sam', lastName: null } })).toBe(
      'Sam',
    );
  });

  it('shows Unknown for a null user', () => {
    expect(personName(null)).toBe('Unknown');
  });
});

describe('formatMoney', () => {
  it('groups thousands and keeps two decimals without float parsing', () => {
    expect(formatMoney('1250', 'USD')).toBe('USD 1,250.00');
    expect(formatMoney('1234567.5', 'USD')).toBe('USD 1,234,567.50');
    expect(formatMoney('99.99', 'INR')).toBe('INR 99.99');
  });

  it('preserves exact large values (no rounding)', () => {
    expect(formatMoney('9007199254740993.01', 'USD')).toBe('USD 9,007,199,254,740,993.01');
  });

  it('handles negatives and blanks', () => {
    expect(formatMoney('-500', 'USD')).toBe('-USD 500.00');
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney('', 'USD')).toBe('—');
  });
});
