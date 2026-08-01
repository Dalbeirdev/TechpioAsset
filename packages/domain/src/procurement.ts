/**
 * Procurement logic — v2.4 (blueprint Volume III, Module 1). Pure: the PR
 * status machine, the SoD rule for approving purchases, the Finance threshold
 * (inclusive at the boundary, aligned with BR-05), and the receipt math that
 * rolls a purchase order's status up from its lines.
 */

export const PURCHASE_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CONVERTED',
  'CANCELLED',
] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

/**
 * Legal PR transitions. REJECTED → SUBMITTED allows fix-and-resubmit;
 * CONVERTED and CANCELLED are terminal.
 */
const PR_TRANSITIONS: Readonly<Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CONVERTED', 'CANCELLED'],
  REJECTED: ['SUBMITTED', 'CANCELLED'],
  CONVERTED: [],
  CANCELLED: [],
};

export function canTransitionPurchaseRequest(
  from: PurchaseRequestStatus,
  to: PurchaseRequestStatus,
): boolean {
  return PR_TRANSITIONS[from].includes(to);
}

/** SoD (the BR-04 rule applied to purchasing): nobody approves their own PR. */
export function canApprovePurchaseRequest(actorId: string, requesterId: string): boolean {
  return actorId !== requesterId;
}

/**
 * Whether a PR needs the Finance approver. Inclusive at the boundary: a cost
 * exactly AT the threshold still needs Finance (BR-05 semantics, matching the
 * request-workflow alignment shipped in the v2.3 QA backlog).
 */
export function needsFinanceApproval(
  estimatedTotal: string | number | null | undefined,
  threshold: string | number,
): boolean {
  if (estimatedTotal === null || estimatedTotal === undefined) return true; // unknown cost goes to a human
  const cost = Number(estimatedTotal);
  const limit = Number(threshold);
  if (!Number.isFinite(cost) || !Number.isFinite(limit)) return true;
  return cost >= limit;
}

// ── receipt math ─────────────────────────────────────────────────────────────

export interface ReceivableLine {
  quantity: string | number;
  receivedQuantity: string | number;
}

/** Units still expected on a PO line. Never negative. */
export function remainingQuantity(line: ReceivableLine): number {
  return Math.max(0, Number(line.quantity) - Number(line.receivedQuantity));
}

/** A receipt may deliver at most what is still outstanding. */
export function canReceive(line: ReceivableLine, quantity: number): boolean {
  return quantity > 0 && quantity <= remainingQuantity(line);
}

/**
 * The PO status its lines imply. Fully received on every line → RECEIVED;
 * anything received at all → PARTIALLY_RECEIVED; nothing yet → ISSUED.
 */
export function rollupPurchaseOrderStatus(
  lines: readonly ReceivableLine[],
): 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' {
  if (lines.length === 0) return 'ISSUED';
  const anyReceived = lines.some((l) => Number(l.receivedQuantity) > 0);
  const allReceived = lines.every((l) => Number(l.receivedQuantity) >= Number(l.quantity));
  if (allReceived && anyReceived) return 'RECEIVED';
  if (anyReceived) return 'PARTIALLY_RECEIVED';
  return 'ISSUED';
}

/** Honest refusal message for an over-receipt attempt. */
export function overReceiptMessage(line: ReceivableLine, attempted: number): string {
  return (
    `Cannot receive ${attempted}: only ${remainingQuantity(line)} of ` +
    `${Number(line.quantity)} ordered unit(s) remain outstanding on this line.`
  );
}
