import Decimal from 'decimal.js';
import { money, roundMoney, type MoneyInput } from './money.js';

/**
 * v2.9 C3 — comparing quotes.
 *
 * The point of an RFQ is not to collect prices; it is to make the choice
 * defensible afterwards. So the comparison names the cheapest and the fastest
 * explicitly, and says out loud when they are different vendors — which is the
 * only moment the award reason is doing real work.
 */

export interface ComparableQuote {
  id: string;
  vendorName: string;
  /** Null until the vendor has actually responded. */
  total: MoneyInput | null;
  leadTimeDays?: number | null;
  status: string;
}

export interface QuoteComparisonRow extends ComparableQuote {
  rank: number | null;
  isCheapest: boolean;
  isFastest: boolean;
  /** How much more than the cheapest response, in the same currency. */
  premiumOverCheapest: string | null;
}

export interface QuoteComparison {
  rows: QuoteComparisonRow[];
  responded: number;
  awaiting: number;
  cheapestQuoteId: string | null;
  fastestQuoteId: string | null;
  /**
   * True when the cheapest quote is not also the fastest. A buyer choosing the
   * dearer, faster vendor is making a trade-off somebody may later question,
   * which is exactly what the award reason exists to record.
   */
  cheapestIsNotFastest: boolean;
}

const respondedStatuses = new Set(['RECEIVED', 'AWARDED', 'LOST']);

export function compareQuotes(quotes: readonly ComparableQuote[]): QuoteComparison {
  const responded = quotes.filter((q) => respondedStatuses.has(q.status) && q.total !== null);
  const ranked = [...responded].sort((a, b) => money(a.total!).comparedTo(money(b.total!)));

  const cheapest = ranked[0] ?? null;
  const withLeadTime = responded.filter((q) => typeof q.leadTimeDays === 'number');
  const fastest = withLeadTime.length
    ? withLeadTime.reduce((best, q) => (q.leadTimeDays! < best.leadTimeDays! ? q : best))
    : null;

  const rankById = new Map(ranked.map((q, i) => [q.id, i + 1]));
  const rows = quotes.map((q) => ({
    ...q,
    rank: rankById.get(q.id) ?? null,
    isCheapest: cheapest?.id === q.id,
    isFastest: fastest?.id === q.id,
    premiumOverCheapest:
      cheapest && q.total !== null && rankById.has(q.id)
        ? roundMoney(money(q.total).minus(money(cheapest.total!))).toFixed(2)
        : null,
  }));

  return {
    rows,
    responded: responded.length,
    awaiting: quotes.length - responded.length,
    cheapestQuoteId: cheapest?.id ?? null,
    fastestQuoteId: fastest?.id ?? null,
    cheapestIsNotFastest: Boolean(cheapest && fastest && cheapest.id !== fastest.id),
  };
}

/** subtotal = sum of quantity x unit price, each line rounded once. */
export function quoteSubtotal(
  lines: readonly { quantity: MoneyInput; unitPrice: MoneyInput }[],
): Decimal {
  return roundMoney(
    lines.reduce<Decimal>((sum, l) => sum.plus(roundMoney(money(l.quantity).times(money(l.unitPrice)))), new Decimal(0)),
  );
}

/**
 * The refusal when somebody tries to order from a quote that did not win.
 * It names the winner, because the useful next step is always "use that one".
 */
export function losingQuoteMessage(attempted: { vendorName: string }, awarded: { vendorName: string } | null): string {
  return awarded
    ? `That quote did not win: ${attempted.vendorName} was not awarded, ${awarded.vendorName} was. ` +
        'Only the awarded quote can become a purchase order.'
    : `No quote has been awarded on this request yet, so ${attempted.vendorName} cannot become an order. ` +
        'Award one first, with a reason.';
}
