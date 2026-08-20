import type { RequestStatus } from './request-status';

/**
 * How far along a request is, for the person who raised it (v2.25).
 *
 * A requester should be able to answer "where has it got to?" without reading
 * an approval chain or knowing what any role is called. Progress is derived
 * from the status alone rather than from steps completed, because the number of
 * steps varies by workflow and by cost - a two-step chain reaching its end is
 * not "further along" than a four-step chain at its third.
 *
 * The percentages are deliberately coarse and never reach 100 until the request
 * is genuinely finished: a progress bar that sits at 99% is a worse lie than one
 * that sits at 80%.
 */

export interface RequestProgress {
  /** 0-100, coarse by design. */
  percent: number;
  /** What is happening now, in the requester's language. */
  stage: string;
  /**
   * Whose desk it is on, named by function rather than by role key, and cased
   * to read after "Currently with …" - so lowercase unless it is a name or an
   * initialism.
   */
  with: string | null;
  /** True once nothing further will happen. */
  settled: boolean;
}

const PROGRESS: Record<RequestStatus, RequestProgress> = {
  DRAFT: { percent: 0, stage: 'Not submitted yet', with: 'you', settled: false },
  SUBMITTED: { percent: 10, stage: 'Submitted', with: 'Approvals', settled: false },

  MANAGER_APPROVAL_PENDING: {
    percent: 25,
    stage: 'Manager review',
    with: 'your manager',
    settled: false,
  },
  HR_REVIEW_PENDING: { percent: 35, stage: 'HR review', with: 'HR', settled: false },
  IT_REVIEW_PENDING: { percent: 45, stage: 'IT review', with: 'IT', settled: false },
  OFFICE_ADMIN_REVIEW_PENDING: {
    percent: 45,
    stage: 'Inventory / procurement review',
    with: 'Office administration',
    settled: false,
  },
  FINANCE_APPROVAL_PENDING: {
    percent: 60,
    stage: 'Finance approval',
    with: 'Finance',
    settled: false,
  },

  APPROVED: { percent: 70, stage: 'Approved — being prepared', with: 'Fulfilment', settled: false },
  INVENTORY_RESERVED: {
    percent: 78,
    stage: 'Reserved from stock',
    with: 'Fulfilment',
    settled: false,
  },
  ORDERED: { percent: 82, stage: 'Ordered from the supplier', with: 'Procurement', settled: false },
  RECEIVED: { percent: 88, stage: 'Arrived and being booked in', with: 'IT', settled: false },
  READY_FOR_ASSIGNMENT: {
    percent: 94,
    stage: 'Ready for collection',
    with: 'IT',
    settled: false,
  },
  ASSIGNED: { percent: 97, stage: 'Issued — confirm receipt', with: 'you', settled: false },

  COMPLETED: { percent: 100, stage: 'Completed', with: null, settled: true },
  REJECTED: { percent: 100, stage: 'Declined', with: null, settled: true },
  CANCELLED: { percent: 100, stage: 'Withdrawn', with: null, settled: true },
};

export function requestProgress(status: RequestStatus): RequestProgress {
  return PROGRESS[status];
}
