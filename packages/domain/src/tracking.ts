/** Spec section 5 - the two tracking models an item may use. */
export const TRACKING_TYPES = ['INDIVIDUAL', 'QUANTITY'] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

/** Spec section 6 - recorded physical condition. */
export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED', 'UNUSABLE'] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

/**
 * Individually tracked assets carry a serial number, QR code and their own
 * lifecycle; quantity-tracked stock carries a balance instead. Mixing the two
 * silently is the classic asset-register bug (assigning "3 of laptop"), so the
 * distinction is enforced rather than conventional.
 */
export function requiresSerialNumber(trackingType: TrackingType): boolean {
  return trackingType === 'INDIVIDUAL';
}

export function supportsAssignment(trackingType: TrackingType): boolean {
  return trackingType === 'INDIVIDUAL';
}

export function isBelowReorderLevel(item: {
  quantityOnHand: number;
  reorderLevel: number | null;
}): boolean {
  if (item.reorderLevel === null) return false;
  return item.quantityOnHand <= item.reorderLevel;
}
