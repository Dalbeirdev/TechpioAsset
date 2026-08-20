import { describe, expect, it } from 'vitest';
import { REQUEST_STATUSES, type RequestStatus } from './request-status';
import { requestProgress } from './request-progress';

/**
 * The requester's answer to "where has it got to?".
 */
describe('requestProgress', () => {
  it('covers every status - a request can never be in an undescribed state', () => {
    for (const status of REQUEST_STATUSES) {
      const p = requestProgress(status as RequestStatus);
      expect(p, status).toBeTruthy();
      expect(p.stage.length, status).toBeGreaterThan(0);
    }
  });

  it('only reaches 100 once nothing further will happen', () => {
    for (const status of REQUEST_STATUSES) {
      const p = requestProgress(status as RequestStatus);
      if (p.percent === 100) expect(p.settled, status).toBe(true);
      if (!p.settled) expect(p.percent, status).toBeLessThan(100);
    }
  });

  it('advances through the chain rather than jumping about', () => {
    const order: RequestStatus[] = [
      'DRAFT',
      'SUBMITTED',
      'MANAGER_APPROVAL_PENDING',
      'HR_REVIEW_PENDING',
      'FINANCE_APPROVAL_PENDING',
      'APPROVED',
      'ORDERED',
      'RECEIVED',
      'READY_FOR_ASSIGNMENT',
      'COMPLETED',
    ];
    const percents = order.map((s) => requestProgress(s).percent);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]!, `${order[i]} after ${order[i - 1]}`).toBeGreaterThan(percents[i - 1]!);
    }
  });

  it('names a desk in the requester’s language, not a role key', () => {
    expect(requestProgress('OFFICE_ADMIN_REVIEW_PENDING').with).toBe('Office administration');
    expect(requestProgress('FINANCE_APPROVAL_PENDING').stage).toBe('Finance approval');
    // A settled request is with nobody.
    expect(requestProgress('COMPLETED').with).toBeNull();
  });
});
