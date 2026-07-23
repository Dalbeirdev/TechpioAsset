import { describe, it, expect } from 'vitest';
import { contrastRatio, relativeLuminance, WCAG_AA_NORMAL_TEXT } from './contrast.js';
import { TONES, TONE_PALETTE_LIGHT, TONE_PALETTE_DARK } from './tones.js';

describe('WCAG contrast math (success criterion 1.4.3)', () => {
  it('gives the maximum ratio of 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('gives 1:1 for a colour against itself', () => {
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#334155', '#f1f5f9')).toBeCloseTo(
      contrastRatio('#f1f5f9', '#334155'),
      10,
    );
  });

  it('ranks white as maximally luminous and black as minimally', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });
});

describe('every status tone meets WCAG 2.1 AA for badge text (spec section 26)', () => {
  it.each(TONES)('light palette: %s fg-on-bg is >= 4.5:1', (tone) => {
    const { fg, bg } = TONE_PALETTE_LIGHT[tone];
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${tone} light ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    );
  });

  it.each(TONES)('dark palette: %s fg-on-bg is >= 4.5:1', (tone) => {
    const { fg, bg } = TONE_PALETTE_DARK[tone];
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${tone} dark ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      WCAG_AA_NORMAL_TEXT,
    );
  });
});
