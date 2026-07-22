import { describe, it, expect } from 'vitest';
import {
  verifyInvoice,
  deriveOutcome,
  type InvoiceInput,
  type VerificationContext,
} from './invoice-verification';

/**
 * The deterministic verification engine is the part spec section 9 forbids AI
 * from touching, so it gets the most thorough tests in the suite. Each mismatch
 * class the spec names (section 26: quantity, cost, duplicate, missing asset) has
 * a test that produces it and one that does not.
 */

function cleanInvoice(over: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    invoiceNumber: 'INV-001',
    currency: 'USD',
    invoiceDate: new Date('2026-06-01'),
    subtotal: '2000.00',
    discount: '0.00',
    tax: '200.00',
    shipping: '0.00',
    total: '2200.00',
    lines: [
      {
        lineNumber: 1,
        description: 'Laptop',
        quantity: 1,
        unitPrice: '1500.00',
        lineTotal: '1500.00',
      },
      {
        lineNumber: 2,
        description: 'Monitor',
        quantity: 1,
        unitPrice: '500.00',
        lineTotal: '500.00',
      },
    ],
    ...over,
  };
}

function cleanContext(over: Partial<VerificationContext> = {}): VerificationContext {
  return {
    duplicateInvoiceNumbers: [],
    duplicateFileHashes: [],
    knownSerialNumbers: [],
    lineMatches: {
      1: { matched: true },
      2: { matched: true },
    },
    allowedCurrencies: ['USD', 'EUR', 'GBP', 'INR'],
    ...over,
  };
}

describe('a clean invoice', () => {
  it('produces no errors and matches', () => {
    const report = verifyInvoice(cleanInvoice(), cleanContext());
    expect(report.hasErrors).toBe(false);
    expect(report.outcome).toBe('MATCHED');
    expect(report.issues).toEqual([]);
    expect(report.computed.total).toBe('2200.00');
  });

  it('tolerates a one-cent per-line rounding divergence', () => {
    const report = verifyInvoice(
      cleanInvoice({
        lines: [
          { lineNumber: 1, description: 'A', quantity: 3, unitPrice: '33.33', lineTotal: '99.99' },
        ],
        subtotal: '99.99',
        tax: '0.00',
        total: '100.00', // one cent off, within tolerance
      }),
      cleanContext({ lineMatches: { 1: { matched: true } } }),
    );
    expect(report.hasErrors).toBe(false);
  });
});

describe('cost mismatches (spec section 26)', () => {
  it('detects a wrong invoice total', () => {
    const report = verifyInvoice(cleanInvoice({ total: '9999.00' }), cleanContext());
    expect(report.hasErrors).toBe(true);
    expect(report.outcome).toBe('COST_MISMATCH');
    const totalIssue = report.issues.find((i) => i.code === 'TOTAL_MISMATCH');
    expect(totalIssue?.expected).toBe('2200.00');
    expect(totalIssue?.actual).toBe('9999.00');
  });

  it('detects a line total that is not quantity × unit price', () => {
    const report = verifyInvoice(
      cleanInvoice({
        lines: [
          {
            lineNumber: 1,
            description: 'Laptop',
            quantity: 2,
            unitPrice: '1500.00',
            lineTotal: '1500.00',
          },
        ],
        subtotal: '1500.00',
        tax: '0',
        total: '1500.00',
      }),
      cleanContext({ lineMatches: { 1: { matched: true } } }),
    );
    const issue = report.issues.find((i) => i.code === 'LINE_TOTAL_MISMATCH');
    expect(issue?.expected).toBe('3000.00');
    expect(report.outcome).toBe('COST_MISMATCH');
  });

  it('detects a subtotal that does not match the sum of lines', () => {
    const report = verifyInvoice(
      cleanInvoice({ subtotal: '1800.00', tax: '0', total: '1800.00' }),
      cleanContext(),
    );
    expect(report.issues.some((i) => i.code === 'SUBTOTAL_MISMATCH')).toBe(true);
  });

  it('detects a unit-price mismatch against the application record', () => {
    const report = verifyInvoice(
      cleanInvoice(),
      cleanContext({
        lineMatches: {
          1: { matched: true, expectedUnitPrice: '1400.00' },
          2: { matched: true },
        },
      }),
    );
    const issue = report.issues.find((i) => i.code === 'UNIT_PRICE_MISMATCH');
    expect(issue).toBeDefined();
    expect(issue?.expected).toBe('1400.00');
  });

  it('rejects a discount larger than the subtotal', () => {
    const report = verifyInvoice(
      cleanInvoice({ discount: '5000.00', total: '0.00' }),
      cleanContext(),
    );
    expect(report.hasErrors).toBe(true);
    expect(report.issues.some((i) => i.code === 'DISCOUNT_INVALID')).toBe(true);
  });
});

describe('quantity mismatches (spec section 26)', () => {
  it('detects an invoice quantity that differs from the expected', () => {
    const report = verifyInvoice(
      cleanInvoice({
        lines: [
          {
            lineNumber: 1,
            description: 'Laptop',
            quantity: 5,
            unitPrice: '1500.00',
            lineTotal: '7500.00',
          },
        ],
        subtotal: '7500.00',
        tax: '0',
        total: '7500.00',
      }),
      cleanContext({
        lineMatches: { 1: { matched: true, expectedQuantity: '3' } },
      }),
    );
    const issue = report.issues.find((i) => i.code === 'QUANTITY_MISMATCH');
    expect(issue?.expected).toBe('3');
    expect(issue?.actual).toBe('5');
    expect(report.outcome).toBe('QUANTITY_MISMATCH');
  });

  it('does not flag a matching quantity', () => {
    const report = verifyInvoice(
      cleanInvoice(),
      cleanContext({
        lineMatches: { 1: { matched: true, expectedQuantity: '1' }, 2: { matched: true } },
      }),
    );
    expect(report.issues.some((i) => i.code === 'QUANTITY_MISMATCH')).toBe(false);
  });
});

describe('duplicate detection (spec section 26)', () => {
  it('flags a duplicate invoice number', () => {
    const report = verifyInvoice(
      cleanInvoice(),
      cleanContext({ duplicateInvoiceNumbers: ['other-id'] }),
    );
    expect(report.outcome).toBe('DUPLICATE_SUSPECTED');
    expect(report.hasErrors).toBe(true);
  });

  it('flags a duplicate file hash', () => {
    const report = verifyInvoice(
      cleanInvoice({ fileSha256: 'abc123' }),
      cleanContext({ duplicateFileHashes: ['other-doc'] }),
    );
    expect(report.outcome).toBe('DUPLICATE_SUSPECTED');
  });

  it('flags a serial number repeated within the invoice', () => {
    const report = verifyInvoice(
      cleanInvoice({
        lines: [
          {
            lineNumber: 1,
            description: 'Laptop',
            quantity: 1,
            unitPrice: '1000.00',
            lineTotal: '1000.00',
            serialNumbers: ['SN1'],
          },
          {
            lineNumber: 2,
            description: 'Laptop',
            quantity: 1,
            unitPrice: '1000.00',
            lineTotal: '1000.00',
            serialNumbers: ['SN1'],
          },
        ],
        subtotal: '2000.00',
        tax: '0',
        total: '2000.00',
      }),
      cleanContext({ lineMatches: { 1: { matched: true }, 2: { matched: true } } }),
    );
    expect(report.issues.some((i) => i.code === 'DUPLICATE_SERIAL')).toBe(true);
    expect(report.outcome).toBe('SERIAL_NUMBER_MISMATCH');
  });

  it('warns on a serial already recorded on an existing asset', () => {
    const report = verifyInvoice(
      cleanInvoice({
        lines: [
          {
            lineNumber: 1,
            description: 'Laptop',
            quantity: 1,
            unitPrice: '2000.00',
            lineTotal: '2000.00',
            serialNumbers: ['EXISTING'],
          },
        ],
        subtotal: '2000.00',
        tax: '0',
        total: '2000.00',
      }),
      cleanContext({ knownSerialNumbers: ['EXISTING'], lineMatches: { 1: { matched: true } } }),
    );
    expect(report.issues.some((i) => i.code === 'DUPLICATE_SERIAL')).toBe(true);
  });
});

describe('missing asset and unlinked lines (spec section 26)', () => {
  it('flags a line that references a not-yet-created asset', () => {
    const report = verifyInvoice(
      cleanInvoice(),
      cleanContext({
        lineMatches: { 1: { matched: true, assetMissing: true }, 2: { matched: true } },
      }),
    );
    expect(report.issues.some((i) => i.code === 'ASSET_MISSING')).toBe(true);
    expect(report.outcome).toBe('ASSET_MISSING');
  });

  it('flags an unlinked line as partially matched', () => {
    const report = verifyInvoice(
      cleanInvoice(),
      cleanContext({ lineMatches: { 1: { matched: true }, 2: { matched: false } } }),
    );
    expect(report.issues.some((i) => i.code === 'LINE_UNLINKED')).toBe(true);
    expect(report.outcome).toBe('PARTIALLY_MATCHED');
  });
});

describe('currency and date', () => {
  it('rejects a malformed currency code', () => {
    const report = verifyInvoice(cleanInvoice({ currency: 'DOLLARS' }), cleanContext());
    expect(report.issues.some((i) => i.code === 'CURRENCY_INVALID' && i.severity === 'ERROR')).toBe(
      true,
    );
  });

  it('warns on a currency not on the accepted list', () => {
    const report = verifyInvoice(cleanInvoice({ currency: 'JPY' }), cleanContext());
    expect(
      report.issues.some((i) => i.code === 'CURRENCY_INVALID' && i.severity === 'WARNING'),
    ).toBe(true);
  });

  it('warns on a future-dated invoice', () => {
    const report = verifyInvoice(
      cleanInvoice({ invoiceDate: new Date(Date.now() + 30 * 86_400_000) }),
      cleanContext(),
    );
    expect(report.issues.some((i) => i.code === 'DATE_INVALID')).toBe(true);
  });
});

describe('purchase order reconciliation', () => {
  it('warns when the invoice total does not match the PO', () => {
    const report = verifyInvoice(cleanInvoice(), cleanContext({ purchaseOrderTotal: '2500.00' }));
    const issue = report.issues.find((i) => i.code === 'PO_TOTAL_MISMATCH');
    expect(issue?.expected).toBe('2500.00');
  });

  it('does not warn when they match', () => {
    const report = verifyInvoice(cleanInvoice(), cleanContext({ purchaseOrderTotal: '2200.00' }));
    expect(report.issues.some((i) => i.code === 'PO_TOTAL_MISMATCH')).toBe(false);
  });
});

describe('robustness', () => {
  it('never throws on malformed money and reports it instead', () => {
    const report = verifyInvoice(
      cleanInvoice({ total: 'not-a-number', subtotal: 'garbage' }),
      cleanContext(),
    );
    expect(report.hasErrors).toBe(true);
    // The engine degraded gracefully rather than crashing the verification.
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it('handles an empty line list without crashing', () => {
    const report = verifyInvoice(
      cleanInvoice({ lines: [], subtotal: '0.00', tax: '0', total: '0.00' }),
      cleanContext({ lineMatches: {} }),
    );
    expect(report.computed.lineTotalSum).toBe('0.00');
  });
});

describe('deriveOutcome precedence', () => {
  it('never returns VERIFIED or REJECTED — those need a human', () => {
    // Whatever issues are present, the engine will not self-approve.
    for (const outcome of [
      deriveOutcome([]),
      deriveOutcome([{ code: 'TOTAL_MISMATCH', severity: 'ERROR', message: 'x' }]),
      deriveOutcome([{ code: 'DUPLICATE_INVOICE_NUMBER', severity: 'ERROR', message: 'x' }]),
    ]) {
      expect(outcome).not.toBe('VERIFIED');
      expect(outcome).not.toBe('REJECTED');
    }
  });

  it('ranks a duplicate above a cost mismatch', () => {
    const outcome = deriveOutcome([
      { code: 'TOTAL_MISMATCH', severity: 'ERROR', message: 'x' },
      { code: 'DUPLICATE_INVOICE_NUMBER', severity: 'ERROR', message: 'x' },
    ]);
    expect(outcome).toBe('DUPLICATE_SUSPECTED');
  });

  it('returns MATCHED for a clean issue set', () => {
    expect(deriveOutcome([])).toBe('MATCHED');
  });
});
