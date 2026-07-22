import {
  ASSET_STATUSES,
  REQUEST_STATUSES,
  VERIFICATION_STATUSES,
  ASSET_CONDITIONS,
  type AssetStatus,
  type RequestStatus,
  type VerificationStatus,
  type AssetCondition,
} from '@techpioasset/domain';
import type { Tone } from './tones';

export interface StatusToken {
  /** Human label. Sentence case - these appear inside badges, not as headings. */
  readonly label: string;
  readonly tone: Tone;
  /** Lucide icon name. Spec section 2: one icon library, no mixed styles. */
  readonly icon: string;
}

export const ASSET_STATUS_TOKENS: Readonly<Record<AssetStatus, StatusToken>> = {
  DRAFT: { label: 'Draft', tone: 'muted', icon: 'FileEdit' },
  REQUESTED: { label: 'Requested', tone: 'info', icon: 'ClipboardList' },
  ORDERED: { label: 'Ordered', tone: 'info', icon: 'ShoppingCart' },
  RECEIVED: { label: 'Received', tone: 'progress', icon: 'PackageCheck' },
  AVAILABLE: { label: 'Available', tone: 'success', icon: 'CircleCheck' },
  RESERVED: { label: 'Reserved', tone: 'progress', icon: 'BookmarkCheck' },
  ASSIGNED: { label: 'Assigned', tone: 'info', icon: 'UserCheck' },
  IN_USE: { label: 'In use', tone: 'info', icon: 'Laptop' },
  IN_STORAGE: { label: 'In storage', tone: 'neutral', icon: 'Archive' },
  IN_TRANSIT: { label: 'In transit', tone: 'progress', icon: 'Truck' },
  UNDER_REPAIR: { label: 'Under repair', tone: 'warning', icon: 'Wrench' },
  DAMAGED: { label: 'Damaged', tone: 'danger', icon: 'TriangleAlert' },
  LOST: { label: 'Lost', tone: 'critical', icon: 'SearchX' },
  STOLEN: { label: 'Stolen', tone: 'critical', icon: 'ShieldAlert' },
  RETURNED: { label: 'Returned', tone: 'neutral', icon: 'Undo2' },
  RETIRED: { label: 'Retired', tone: 'muted', icon: 'PackageMinus' },
  DISPOSED: { label: 'Disposed', tone: 'muted', icon: 'Trash2' },
  DONATED: { label: 'Donated', tone: 'muted', icon: 'HeartHandshake' },
};

export const REQUEST_STATUS_TOKENS: Readonly<Record<RequestStatus, StatusToken>> = {
  DRAFT: { label: 'Draft', tone: 'muted', icon: 'FileEdit' },
  SUBMITTED: { label: 'Submitted', tone: 'info', icon: 'Send' },
  MANAGER_APPROVAL_PENDING: { label: 'Manager approval', tone: 'warning', icon: 'UserCog' },
  HR_REVIEW_PENDING: { label: 'HR review', tone: 'warning', icon: 'Users' },
  IT_REVIEW_PENDING: { label: 'IT review', tone: 'warning', icon: 'MonitorCog' },
  OFFICE_ADMIN_REVIEW_PENDING: { label: 'Office review', tone: 'warning', icon: 'Building2' },
  FINANCE_APPROVAL_PENDING: { label: 'Finance approval', tone: 'warning', icon: 'Banknote' },
  APPROVED: { label: 'Approved', tone: 'success', icon: 'CircleCheck' },
  REJECTED: { label: 'Rejected', tone: 'critical', icon: 'CircleX' },
  INVENTORY_RESERVED: { label: 'Stock reserved', tone: 'progress', icon: 'BookmarkCheck' },
  ORDERED: { label: 'Ordered', tone: 'progress', icon: 'ShoppingCart' },
  RECEIVED: { label: 'Received', tone: 'progress', icon: 'PackageCheck' },
  READY_FOR_ASSIGNMENT: { label: 'Ready to assign', tone: 'progress', icon: 'PackageOpen' },
  ASSIGNED: { label: 'Assigned', tone: 'info', icon: 'UserCheck' },
  COMPLETED: { label: 'Completed', tone: 'success', icon: 'CircleCheckBig' },
  CANCELLED: { label: 'Cancelled', tone: 'muted', icon: 'Ban' },
};

export const VERIFICATION_STATUS_TOKENS: Readonly<Record<VerificationStatus, StatusToken>> = {
  UPLOADED: { label: 'Uploaded', tone: 'neutral', icon: 'Upload' },
  PENDING_AI_PROCESSING: { label: 'Queued for AI', tone: 'progress', icon: 'Clock' },
  AI_PROCESSING: { label: 'AI processing', tone: 'progress', icon: 'Sparkles' },
  AI_FAILED: { label: 'AI failed', tone: 'critical', icon: 'CircleX' },
  EXTRACTION_COMPLETED: { label: 'Extracted', tone: 'info', icon: 'ScanText' },
  PENDING_REVIEW: { label: 'Pending review', tone: 'warning', icon: 'Eye' },
  MATCHED: { label: 'Matched', tone: 'success', icon: 'CircleCheck' },
  PARTIALLY_MATCHED: { label: 'Partially matched', tone: 'warning', icon: 'CircleDashed' },
  DUPLICATE_SUSPECTED: { label: 'Possible duplicate', tone: 'danger', icon: 'CopyCheck' },
  ASSET_MISSING: { label: 'Asset missing', tone: 'danger', icon: 'PackageX' },
  QUANTITY_MISMATCH: { label: 'Quantity mismatch', tone: 'danger', icon: 'Sigma' },
  COST_MISMATCH: { label: 'Cost mismatch', tone: 'danger', icon: 'BadgeDollarSign' },
  SERIAL_NUMBER_MISMATCH: { label: 'Serial mismatch', tone: 'danger', icon: 'Barcode' },
  MANUAL_REVIEW_REQUIRED: { label: 'Manual review', tone: 'warning', icon: 'UserSearch' },
  VERIFIED: { label: 'Verified', tone: 'success', icon: 'ShieldCheck' },
  REJECTED: { label: 'Rejected', tone: 'critical', icon: 'CircleX' },
};

export const CONDITION_TOKENS: Readonly<Record<AssetCondition, StatusToken>> = {
  NEW: { label: 'New', tone: 'success', icon: 'Sparkle' },
  GOOD: { label: 'Good', tone: 'success', icon: 'ThumbsUp' },
  FAIR: { label: 'Fair', tone: 'warning', icon: 'Minus' },
  POOR: { label: 'Poor', tone: 'danger', icon: 'ThumbsDown' },
  DAMAGED: { label: 'Damaged', tone: 'danger', icon: 'TriangleAlert' },
  UNUSABLE: { label: 'Unusable', tone: 'critical', icon: 'OctagonX' },
};

/** Every status enum paired with its token map, for exhaustiveness testing. */
export const STATUS_TOKEN_REGISTRY = [
  { name: 'AssetStatus', values: ASSET_STATUSES, tokens: ASSET_STATUS_TOKENS },
  { name: 'RequestStatus', values: REQUEST_STATUSES, tokens: REQUEST_STATUS_TOKENS },
  { name: 'VerificationStatus', values: VERIFICATION_STATUSES, tokens: VERIFICATION_STATUS_TOKENS },
  { name: 'AssetCondition', values: ASSET_CONDITIONS, tokens: CONDITION_TOKENS },
] as const;
