import Decimal from 'decimal.js';
import { money, roundMoney, computeInvoiceTotal, totalsAgree, computeLineTotal } from './money';
import type { VerificationStatus } from './verification-status';

/**
 * Deterministic invoice verification (spec section 9).
 *
 * This module is pure: no database, no network, no AI. Spec section 9 is
 * explicit — "Do not use AI for exact mathematical or database validation" — so
 * every figure here is checked with exact decimal arithmetic against data the
 * application already holds. AI may *suggest* a value; only this engine decides
 * whether the numbers add up. Because it is pure it can be tested exhaustively,
 * which is the point: the money math is the part that must never be wrong.
 */

/** One thing the engine found wrong, with enough detail for a reviewer to act. */
export interface VerificationIssue {
  code: VerificationIssueCode;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  message: string;
  /** Line number when the issue is line-scoped; absent for invoice-level issues. */
  lineNumber?: number;
  expected?: string;
  actual?: string;
}

export type VerificationIssueCode =
  | 'SUBTOTAL_MISMATCH'
  | 'TOTAL_MISMATCH'
  | 'LINE_TOTAL_MISMATCH'
  | 'TAX_INVALID'
  | 'DISCOUNT_INVALID'
  | 'NEGATIVE_VALUE'
  | 'DUPLICATE_INVOICE_NUMBER'
  | 'DUPLICATE_FILE_HASH'
  | 'DUPLICATE_SERIAL'
  | 'QUANTITY_MISMATCH'
  | 'UNIT_PRICE_MISMATCH'
  | 'ASSET_MISSING'
  | 'LINE_UNLINKED'
  | 'PO_TOTAL_MISMATCH'
  | 'CURRENCY_INVALID'
  | 'DATE_INVALID';

/** A line as recorded on the invoice. Money arrives as strings for exactness. */
export interface InvoiceLineInput {
  lineNumber: number;
  description: string;
  quantity: string | number;
  unitPrice: string;
  lineTotal: string;
  serialNumbers?: string[];
}

export interface InvoiceInput {
  invoiceNumber: string;
  currency: string;
  invoiceDate: Date;
  subtotal: string;
  discount?: string;
  tax?: string;
  shipping?: string;
  otherCharges?: string;
  total: string;
  lines: InvoiceLineInput[];
  fileSha256?: string;
}

/**
 * Facts from the application's own records, gathered by the service before
 * calling the engine. The engine never reads the database itself; it is handed
 * exactly what it needs so it stays pure and testable.
 */
export interface VerificationContext {
  /** Other invoices in the company with the same number (excluding this one). */
  duplicateInvoiceNumbers: string[];
  /** Other documents with the same file hash. */
  duplicateFileHashes: string[];
  /** Serial numbers already recorded on an existing asset. */
  knownSerialNumbers: string[];
  /** Per line: what the application matched it to, if anything. */
  lineMatches: Record<
    number,
    {
      matched: boolean;
      /** Quantity the matched application record expects, if known. */
      expectedQuantity?: string;
      /** Unit price the matched application record holds, if known. */
      expectedUnitPrice?: string;
      /** True when the line names assets that do not exist yet. */
      assetMissing?: boolean;
    }
  >;
  /** Purchase-order total to reconcile against, if the invoice cites a PO. */
  purchaseOrderTotal?: string;
  /** Currency codes the company accepts. */
  allowedCurrencies: string[];
  /** Tolerance for rounding divergence, in minor units. Default 1 cent. */
  toleranceMinorUnits?: number;
}

export interface VerificationReport {
  issues: VerificationIssue[];
  /** The single status this evidence implies, before any human decision. */
  outcome: VerificationStatus;
  /** Recomputed figures, so a reviewer sees what the engine expected. */
  computed: {
    subtotal: string;
    total: string;
    lineTotalSum: string;
  };
  hasErrors: boolean;
}

function issue(
  code: VerificationIssueCode,
  severity: VerificationIssue['severity'],
  message: string,
  extra: Partial<VerificationIssue> = {},
): VerificationIssue {
  return { code, severity, message, ...extra };
}

/**
 * Runs every deterministic check and returns a report.
 *
 * The function is total: it never throws on bad data. Malformed money produces a
 * NEGATIVE_VALUE / mismatch issue rather than an exception, because a reviewer
 * needs to see *that* the invoice is wrong, not have the whole verification fail.
 */
export function verifyInvoice(
  invoice: InvoiceInput,
  context: VerificationContext,
): VerificationReport {
  const issues: VerificationIssue[] = [];
  const tolerance = context.toleranceMinorUnits ?? 1;

  // ── Currency and date ──────────────────────────────────────────────────────
  if (!/^[A-Z]{3}$/.test(invoice.currency)) {
    issues.push(issue('CURRENCY_INVALID', 'ERROR', `Invalid currency code "${invoice.currency}"`));
  } else if (!context.allowedCurrencies.includes(invoice.currency)) {
    issues.push(
      issue(
        'CURRENCY_INVALID',
        'WARNING',
        `Currency ${invoice.currency} is not on the accepted list`,
      ),
    );
  }

  if (Number.isNaN(invoice.invoiceDate.getTime())) {
    issues.push(issue('DATE_INVALID', 'ERROR', 'Invoice date is not a valid date'));
  } else if (invoice.invoiceDate.getTime() > Date.now() + 86_400_000) {
    // One day of slack for timezones; beyond that a future-dated invoice is suspect.
    issues.push(issue('DATE_INVALID', 'WARNING', 'Invoice date is in the future'));
  }

  // ── Duplicates (database facts, gathered by the caller) ────────────────────
  if (context.duplicateInvoiceNumbers.length > 0) {
    issues.push(
      issue(
        'DUPLICATE_INVOICE_NUMBER',
        'ERROR',
        `Invoice number ${invoice.invoiceNumber} already exists`,
      ),
    );
  }
  if (invoice.fileSha256 && context.duplicateFileHashes.length > 0) {
    issues.push(
      issue('DUPLICATE_FILE_HASH', 'ERROR', 'This exact document has already been uploaded'),
    );
  }

  // ── Line arithmetic and matching ───────────────────────────────────────────
  let lineTotalSum = new Decimal(0);
  const seenSerials = new Set<string>();

  for (const line of invoice.lines) {
    let expectedLineTotal: Decimal;
    try {
      expectedLineTotal = computeLineTotal(line.quantity, line.unitPrice);
    } catch {
      issues.push(
        issue(
          'NEGATIVE_VALUE',
          'ERROR',
          `Line ${line.lineNumber} has an invalid quantity or price`,
          {
            lineNumber: line.lineNumber,
          },
        ),
      );
      continue;
    }

    lineTotalSum = lineTotalSum.plus(expectedLineTotal);

    const statedLineTotal = safeMoney(line.lineTotal);
    if (statedLineTotal === null) {
      issues.push(
        issue('LINE_TOTAL_MISMATCH', 'ERROR', `Line ${line.lineNumber} has an invalid line total`, {
          lineNumber: line.lineNumber,
        }),
      );
    } else if (!totalsAgree(statedLineTotal, expectedLineTotal, tolerance)) {
      issues.push(
        issue(
          'LINE_TOTAL_MISMATCH',
          'ERROR',
          `Line ${line.lineNumber}: quantity × unit price is ${expectedLineTotal.toFixed(2)}, invoice says ${statedLineTotal.toFixed(2)}`,
          {
            lineNumber: line.lineNumber,
            expected: expectedLineTotal.toFixed(2),
            actual: statedLineTotal.toFixed(2),
          },
        ),
      );
    }

    // Serial numbers: duplicates within the file, and clashes with existing assets.
    for (const serial of line.serialNumbers ?? []) {
      if (seenSerials.has(serial)) {
        issues.push(
          issue(
            'DUPLICATE_SERIAL',
            'ERROR',
            `Serial ${serial} appears more than once on this invoice`,
            {
              lineNumber: line.lineNumber,
            },
          ),
        );
      }
      seenSerials.add(serial);

      if (context.knownSerialNumbers.includes(serial)) {
        issues.push(
          issue(
            'DUPLICATE_SERIAL',
            'WARNING',
            `Serial ${serial} is already recorded on an existing asset`,
            {
              lineNumber: line.lineNumber,
            },
          ),
        );
      }
    }

    // Match against application records.
    const match = context.lineMatches[line.lineNumber];
    if (!match || !match.matched) {
      issues.push(
        issue(
          'LINE_UNLINKED',
          'WARNING',
          `Line ${line.lineNumber} is not linked to an asset or inventory record`,
          {
            lineNumber: line.lineNumber,
          },
        ),
      );
    } else {
      if (match.assetMissing) {
        issues.push(
          issue(
            'ASSET_MISSING',
            'WARNING',
            `Line ${line.lineNumber} references an asset that has not been created`,
            {
              lineNumber: line.lineNumber,
            },
          ),
        );
      }
      if (match.expectedQuantity !== undefined) {
        const expected = safeMoney(match.expectedQuantity);
        const actual = safeMoney(String(line.quantity));
        if (expected && actual && !expected.equals(actual)) {
          issues.push(
            issue(
              'QUANTITY_MISMATCH',
              'ERROR',
              `Line ${line.lineNumber}: invoice quantity ${actual.toString()} does not match the expected ${expected.toString()}`,
              {
                lineNumber: line.lineNumber,
                expected: expected.toString(),
                actual: actual.toString(),
              },
            ),
          );
        }
      }
      if (match.expectedUnitPrice !== undefined) {
        const expected = safeMoney(match.expectedUnitPrice);
        const actual = safeMoney(line.unitPrice);
        if (expected && actual && !totalsAgree(expected, actual, tolerance)) {
          issues.push(
            issue(
              'UNIT_PRICE_MISMATCH',
              'ERROR',
              `Line ${line.lineNumber}: unit price ${actual.toFixed(2)} does not match the expected ${expected.toFixed(2)}`,
              {
                lineNumber: line.lineNumber,
                expected: expected.toFixed(2),
                actual: actual.toFixed(2),
              },
            ),
          );
        }
      }
    }
  }

  lineTotalSum = roundMoney(lineTotalSum);

  // ── Invoice-level arithmetic ───────────────────────────────────────────────
  const statedSubtotal = safeMoney(invoice.subtotal);
  if (statedSubtotal === null) {
    issues.push(issue('SUBTOTAL_MISMATCH', 'ERROR', 'Subtotal is not a valid amount'));
  } else if (!totalsAgree(statedSubtotal, lineTotalSum, tolerance)) {
    issues.push(
      issue(
        'SUBTOTAL_MISMATCH',
        'ERROR',
        `Line totals sum to ${lineTotalSum.toFixed(2)}, subtotal says ${statedSubtotal.toFixed(2)}`,
        {
          expected: lineTotalSum.toFixed(2),
          actual: statedSubtotal.toFixed(2),
        },
      ),
    );
  }

  for (const [field, value] of [
    ['discount', invoice.discount],
    ['tax', invoice.tax],
    ['shipping', invoice.shipping],
  ] as const) {
    if (value !== undefined) {
      const parsed = safeMoney(value);
      if (parsed === null) {
        issues.push(issue('TAX_INVALID', 'ERROR', `${field} is not a valid amount`));
      } else if (parsed.isNegative()) {
        issues.push(
          issue(
            field === 'discount' ? 'DISCOUNT_INVALID' : 'TAX_INVALID',
            'ERROR',
            `${field} may not be negative`,
          ),
        );
      }
    }
  }

  let computedTotal = new Decimal(0);
  const subtotalForTotal = statedSubtotal ?? lineTotalSum;
  try {
    computedTotal = computeInvoiceTotal({
      subtotal: subtotalForTotal,
      discount: invoice.discount ?? 0,
      tax: invoice.tax ?? 0,
      shipping: invoice.shipping ?? 0,
      otherCharges: invoice.otherCharges ?? 0,
    });
  } catch (error) {
    issues.push(issue('DISCOUNT_INVALID', 'ERROR', (error as Error).message));
    computedTotal = subtotalForTotal;
  }

  const statedTotal = safeMoney(invoice.total);
  if (statedTotal === null) {
    issues.push(issue('TOTAL_MISMATCH', 'ERROR', 'Total is not a valid amount'));
  } else if (!totalsAgree(statedTotal, computedTotal, tolerance)) {
    issues.push(
      issue(
        'TOTAL_MISMATCH',
        'ERROR',
        `Computed total is ${computedTotal.toFixed(2)}, invoice says ${statedTotal.toFixed(2)}`,
        {
          expected: computedTotal.toFixed(2),
          actual: statedTotal.toFixed(2),
        },
      ),
    );
  }

  // ── Purchase order reconciliation ──────────────────────────────────────────
  if (context.purchaseOrderTotal !== undefined) {
    const poTotal = safeMoney(context.purchaseOrderTotal);
    if (poTotal && statedTotal && !totalsAgree(poTotal, statedTotal, tolerance)) {
      issues.push(
        issue(
          'PO_TOTAL_MISMATCH',
          'WARNING',
          `Invoice total ${statedTotal.toFixed(2)} does not match the purchase order total ${poTotal.toFixed(2)}`,
          {
            expected: poTotal.toFixed(2),
            actual: statedTotal.toFixed(2),
          },
        ),
      );
    }
  }

  return {
    issues,
    outcome: deriveOutcome(issues),
    computed: {
      subtotal: (statedSubtotal ?? lineTotalSum).toFixed(2),
      total: computedTotal.toFixed(2),
      lineTotalSum: lineTotalSum.toFixed(2),
    },
    hasErrors: issues.some((i) => i.severity === 'ERROR'),
  };
}

/**
 * Maps the issue set to a single verification status.
 *
 * Deliberately never returns VERIFIED or REJECTED: those require a human
 * (spec section 9), and the engine only reports what the evidence shows. The
 * most specific mismatch wins so the reviewer sees the sharpest label.
 */
export function deriveOutcome(issues: VerificationIssue[]): VerificationStatus {
  const has = (code: VerificationIssueCode) => issues.some((i) => i.code === code);

  if (has('DUPLICATE_INVOICE_NUMBER') || has('DUPLICATE_FILE_HASH')) return 'DUPLICATE_SUSPECTED';
  if (
    has('SUBTOTAL_MISMATCH') ||
    has('TOTAL_MISMATCH') ||
    has('LINE_TOTAL_MISMATCH') ||
    has('UNIT_PRICE_MISMATCH')
  ) {
    return 'COST_MISMATCH';
  }
  if (has('QUANTITY_MISMATCH')) return 'QUANTITY_MISMATCH';
  if (has('DUPLICATE_SERIAL')) return 'SERIAL_NUMBER_MISMATCH';
  if (has('ASSET_MISSING')) return 'ASSET_MISSING';
  if (has('LINE_UNLINKED')) return 'PARTIALLY_MATCHED';
  if (issues.some((i) => i.severity === 'ERROR' || i.severity === 'WARNING'))
    return 'MANUAL_REVIEW_REQUIRED';
  return 'MATCHED';
}

/** Parses money without throwing; returns null on anything invalid. */
function safeMoney(value: string): Decimal | null {
  try {
    return money(value);
  } catch {
    return null;
  }
}
