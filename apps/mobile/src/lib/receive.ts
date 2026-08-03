/**
 * v2.9 C5 — what the dock sends when it receives goods.
 *
 * This lives outside the screen because the shape matters: receiving now
 * CREATES the assets, so a payload missing its category is refused by the API,
 * and a serial typed into the wrong slot ends up on the wrong asset. Both are
 * worth proving without a phone.
 */

export interface ReceiveLinePayload {
  purchaseOrderLineId: string;
  quantity: number;
  intake: 'ASSET';
  categoryId: string;
  serialNumbers?: string[];
}

export function buildReceiveLines(params: {
  /** Raw text from the quantity inputs, keyed by PO line. */
  quantities: Record<string, string>;
  categoryId: string;
  /** Serials keyed by PO line, indexed by unit; blanks are units nobody read. */
  serials: Record<string, string[]>;
}): ReceiveLinePayload[] {
  return Object.entries(params.quantities)
    .map(([purchaseOrderLineId, value]) => ({ purchaseOrderLineId, quantity: Number(value) }))
    .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0)
    .map((l) => {
      // Only as many serials as units received: typing four and then receiving
      // two would otherwise send serials for units that did not arrive.
      const captured = (params.serials[l.purchaseOrderLineId] ?? [])
        .slice(0, l.quantity)
        .map((v) => v.trim())
        .filter(Boolean);
      return {
        ...l,
        intake: 'ASSET' as const,
        categoryId: params.categoryId,
        ...(captured.length ? { serialNumbers: captured } : {}),
      };
    });
}

/** The dock cannot submit without a category: the API would refuse it anyway. */
export function canSubmitReceipt(lines: ReceiveLinePayload[], categoryId: string): boolean {
  return lines.length > 0 && categoryId.trim().length > 0;
}
