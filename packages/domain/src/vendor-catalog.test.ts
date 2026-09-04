import { describe, expect, it } from 'vitest';
import {
  calculateLandedCost,
  effectiveOfferStatus,
  formatInr,
  imageSetProblem,
  isSelectable,
  youtubeVideoId,
  type OfferState,
} from './vendor-catalog';

describe('landed cost', () => {
  const base = {
    unitPrice: 108000,
    gstPercent: 18,
    discount: 0,
    shippingCost: 0,
    installationCost: 0,
    otherCharges: 0,
  };

  it('adds GST to the unit price', () => {
    const r = calculateLandedCost(base);
    expect(r.gstAmount).toBe(19440);
    expect(r.landedCost).toBe(127440);
  });

  it('adds shipping, installation and other charges, and subtracts discount', () => {
    const r = calculateLandedCost({
      ...base,
      gstPercent: 0,
      shippingCost: 1500,
      installationCost: 2000,
      otherCharges: 500,
      discount: 4000,
    });
    expect(r.landedCost).toBe(108000 + 1500 + 2000 + 500 - 4000);
  });

  it('does not drift on values that break floating point', () => {
    // 0.1 + 0.2 !== 0.3 in binary. A landed cost is compared against an approval
    // and an invoice; all three have to be the same number.
    const r = calculateLandedCost({ ...base, unitPrice: 0.1, gstPercent: 0, otherCharges: 0.2 });
    expect(r.landedCost).toBe(0.3);
  });

  it('rounds GST to paise rather than carrying a fraction forward', () => {
    const r = calculateLandedCost({ ...base, unitPrice: 999.99, gstPercent: 18 });
    expect(r.gstAmount).toBe(180);
    expect(r.landedCost).toBe(1179.99);
  });

  it('never returns a negative price, however large the discount', () => {
    // A negative landed cost would be approved and paid by everything downstream.
    const r = calculateLandedCost({ ...base, gstPercent: 0, discount: 999999 });
    expect(r.landedCost).toBe(0);
  });

  it('refuses negative inputs and impossible GST', () => {
    expect(() => calculateLandedCost({ ...base, unitPrice: -1 })).toThrow(/cannot be negative/);
    expect(() => calculateLandedCost({ ...base, gstPercent: 101 })).toThrow(/cannot exceed 100/);
    expect(() => calculateLandedCost({ ...base, shippingCost: Number.NaN })).toThrow(/finite/);
  });
});

describe('Indian rupee formatting', () => {
  it('groups the last three digits, then pairs', () => {
    expect(formatInr(1500)).toBe('₹1,500');
    expect(formatInr(25000)).toBe('₹25,000');
    expect(formatInr(100000)).toBe('₹1,00,000');
    expect(formatInr(1250000)).toBe('₹12,50,000');
    expect(formatInr(10000000)).toBe('₹1,00,00,000');
  });

  it('handles small numbers and zero without stray separators', () => {
    expect(formatInr(0)).toBe('₹0');
    expect(formatInr(9)).toBe('₹9');
    expect(formatInr(999)).toBe('₹999');
  });

  it('shows paise only when asked', () => {
    expect(formatInr(1234.5)).toBe('₹1,235');
    expect(formatInr(1234.5, { paise: true })).toBe('₹1,234.50');
  });

  it('keeps the sign outside the symbol', () => {
    expect(formatInr(-2500)).toBe('-₹2,500');
  });
});

describe('YouTube URLs', () => {
  it('accepts the watch and short forms', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('keeps the id and discards everything else on the URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=PL1')).toBe(
      'dQw4w9WgXcQ',
    );
  });

  it('rejects other hosts, however much they look like YouTube', () => {
    for (const url of [
      'https://vimeo.com/12345678',
      'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      expect(youtubeVideoId(url), url).toBeNull();
    }
  });

  it('rejects anything that is not a URL, and anything that is not an id', () => {
    for (const bad of [
      '',
      null,
      undefined,
      'dQw4w9WgXcQ',
      'javascript:alert(1)',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=waytoolongforanid',
    ]) {
      expect(youtubeVideoId(bad as string), String(bad)).toBeNull();
    }
  });

  it('never returns markup, so nothing a vendor types can run on our page', () => {
    const id = youtubeVideoId(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><script>alert(1)</script>',
    );
    expect(id).toBeNull();
  });
});

describe('what an offer actually is right now', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  const offer = (over: Partial<OfferState> = {}): OfferState => ({
    status: 'APPROVED',
    availableFrom: new Date('2026-09-01T00:00:00Z'),
    availableUntil: new Date('2026-09-30T00:00:00Z'),
    availableQuantity: 10,
    ...over,
  });

  it('is active inside the window with stock', () => {
    expect(effectiveOfferStatus(offer(), now)).toBe('ACTIVE');
  });

  it('warns in the last seven days', () => {
    expect(effectiveOfferStatus(offer(), new Date('2026-09-25T00:00:00Z'))).toBe('EXPIRING_SOON');
  });

  it('expires on its own, without anyone editing it', () => {
    // The failure this prevents: an offer approved in August still reading
    // "active" in October because no one touched it.
    expect(effectiveOfferStatus(offer(), new Date('2026-10-01T00:00:00Z'))).toBe('EXPIRED');
  });

  it('is out of stock at zero quantity', () => {
    expect(effectiveOfferStatus(offer({ availableQuantity: 0 }), now)).toBe('OUT_OF_STOCK');
  });

  it('is not yet available before the window opens', () => {
    expect(effectiveOfferStatus(offer(), new Date('2026-08-20T00:00:00Z'))).toBe('APPROVED');
  });

  it('never overwrites a decision somebody made', () => {
    // Paused, rejected and withdrawn are choices. Arithmetic must not undo them.
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'PAUSED', 'DISCONTINUED'] as const) {
      expect(effectiveOfferStatus(offer({ status }), now)).toBe(status);
    }
  });
});

describe('whether an offer may be selected', () => {
  const now = new Date('2026-09-10T00:00:00Z');
  const offer = (over: Partial<OfferState> = {}): OfferState => ({
    status: 'APPROVED',
    availableFrom: new Date('2026-09-01T00:00:00Z'),
    availableUntil: new Date('2026-09-30T00:00:00Z'),
    availableQuantity: 10,
    ...over,
  });

  it('allows a quantity within stock on a live offer', () => {
    expect(isSelectable(offer(), 10, now)).toBe(true);
    expect(isSelectable(offer(), 1, now)).toBe(true);
  });

  it('allows selection while expiring soon', () => {
    expect(isSelectable(offer(), 1, new Date('2026-09-27T00:00:00Z'))).toBe(true);
  });

  it('refuses an expired offer', () => {
    // Selecting one commits the company to a price the vendor stopped honouring,
    // and it surfaces months later as an invoice mismatch nobody can explain.
    expect(isSelectable(offer(), 1, new Date('2026-10-02T00:00:00Z'))).toBe(false);
  });

  it('refuses more than the vendor has, and refuses nothing', () => {
    expect(isSelectable(offer(), 11, now)).toBe(false);
    expect(isSelectable(offer(), 0, now)).toBe(false);
  });

  it('refuses paused and rejected offers', () => {
    expect(isSelectable(offer({ status: 'PAUSED' }), 1, now)).toBe(false);
    expect(isSelectable(offer({ status: 'REJECTED' }), 1, now)).toBe(false);
  });
});

describe('image count rules', () => {
  it('requires at least one and allows at most three', () => {
    expect(imageSetProblem(0)).toMatch(/at least one image/);
    expect(imageSetProblem(1)).toBeNull();
    expect(imageSetProblem(3)).toBeNull();
    expect(imageSetProblem(4)).toMatch(/at most 3/);
  });
});
