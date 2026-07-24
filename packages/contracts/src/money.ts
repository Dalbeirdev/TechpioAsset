import { z } from 'zod';

/**
 * A monetary amount as a string: non-negative, up to 12 integer digits and two
 * decimals. Rejecting negatives here is deliberate — a negative price, invoice
 * total, or service cost is always a data-entry error and corrupts spend and
 * depreciation totals. Upstream code parses the validated string into a Decimal.
 *
 * Shared by assets, invoices, and maintenance so the rule can never drift apart.
 */
export const moneyString = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a non-negative amount with at most two decimal places');
