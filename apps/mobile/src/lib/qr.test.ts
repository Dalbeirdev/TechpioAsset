import { describe, expect, it } from 'vitest';
import { qrTokenFrom } from './qr';

/**
 * The case that was broken in production: a label printed from the web encodes
 * an address, not a token, and the scanner sent the whole address to an
 * endpoint that matches tokens exactly.
 */
describe('qrTokenFrom', () => {
  const token = '01KYX56HZT81QXS171WT4H9XGG';

  it('takes the token out of a printed label', () => {
    expect(qrTokenFrom(`https://pioassets.com/assets/scan/${token}`)).toBe(token);
  });

  it('works whatever origin the label was printed against', () => {
    // Labels outlive deployments: one printed from a staging origin, or from
    // localhost during setup, still has to scan against production.
    expect(qrTokenFrom(`http://localhost:3000/assets/scan/${token}`)).toBe(token);
    expect(qrTokenFrom(`https://staging.pioassets.com/assets/scan/${token}`)).toBe(token);
  });

  it('ignores a trailing query or fragment', () => {
    expect(qrTokenFrom(`https://pioassets.com/assets/scan/${token}?from=label`)).toBe(token);
    expect(qrTokenFrom(`https://pioassets.com/assets/scan/${token}#top`)).toBe(token);
  });

  it('accepts a bare token, which is what the API itself takes', () => {
    expect(qrTokenFrom(token)).toBe(token);
    expect(qrTokenFrom(`  ${token}  `)).toBe(token);
  });

  it('hands anything else to the API rather than guessing', () => {
    // A foreign code is allowed to be a miss. The API answers "no such asset"
    // and the screen says so - which is true, and cheaper than a classifier
    // that has to be right about every QR format in the world.
    expect(qrTokenFrom('WIFI:S:Office;T:WPA;P:hunter2;;')).toBe('WIFI:S:Office;T:WPA;P:hunter2;;');
    expect(qrTokenFrom('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('refuses an empty scan', () => {
    expect(qrTokenFrom('')).toBeNull();
    expect(qrTokenFrom('   ')).toBeNull();
  });
});
