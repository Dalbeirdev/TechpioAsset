import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS } from './permissions';
import { SOD_CONFLICTS, findSodConflicts, findSodConflictsAcross } from './sod';

const P = PERMISSIONS;

describe('SoD conflict catalogue', () => {
  it('references only permissions that exist in the catalogue', () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    for (const c of SOD_CONFLICTS) {
      expect(known.has(c.a), `${c.id}: unknown permission ${c.a}`).toBe(true);
      expect(known.has(c.b), `${c.id}: unknown permission ${c.b}`).toBe(true);
    }
  });

  it('has unique ids and no self-pairs', () => {
    const ids = SOD_CONFLICTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SOD_CONFLICTS) expect(c.a).not.toBe(c.b);
  });

  it('every conflict carries a human reason', () => {
    for (const c of SOD_CONFLICTS) expect(c.reason.length).toBeGreaterThan(20);
  });
});

describe('findSodConflicts', () => {
  it('flags a permission set holding both sides of a pair', () => {
    const hits = findSodConflicts([P.REQUESTS_CREATE, P.REQUESTS_APPROVE]);
    expect(hits.map((c) => c.id)).toContain('request-and-approve');
  });

  it('does not flag one side alone', () => {
    expect(findSodConflicts([P.REQUESTS_APPROVE])).toHaveLength(0);
    expect(findSodConflicts([P.INVOICES_UPLOAD])).toHaveLength(0);
  });

  it('is empty for an empty set', () => {
    expect(findSodConflicts([])).toHaveLength(0);
  });

  it('flags multiple simultaneous conflicts', () => {
    const hits = findSodConflicts([
      P.INVOICES_UPLOAD,
      P.INVOICES_VERIFY,
      P.PURCHASE_ORDERS_MANAGE,
    ]);
    const ids = hits.map((c) => c.id);
    expect(ids).toContain('upload-and-verify-invoices');
    expect(ids).toContain('purchase-and-verify');
  });
});

describe('findSodConflictsAcross', () => {
  it('flags conflicts arising only from the union of two clean roles', () => {
    const requester = [P.REQUESTS_CREATE];
    const approver = [P.REQUESTS_APPROVE];
    expect(findSodConflicts(requester)).toHaveLength(0);
    expect(findSodConflicts(approver)).toHaveLength(0);
    const combined = findSodConflictsAcross([requester, approver]);
    expect(combined.map((c) => c.id)).toContain('request-and-approve');
  });
});

describe('system role posture', () => {
  it('SUPER_ADMIN conflicts are expected (holds everything) — sanity check the detector fires', () => {
    expect(findSodConflicts(ROLE_PERMISSIONS.SUPER_ADMIN).length).toBeGreaterThan(0);
  });

  it('EMPLOYEE is conflict-free', () => {
    expect(findSodConflicts(ROLE_PERMISSIONS.EMPLOYEE)).toHaveLength(0);
  });

  it('AUDITOR is conflict-free (read-only cannot self-deal)', () => {
    expect(findSodConflicts(ROLE_PERMISSIONS.AUDITOR)).toHaveLength(0);
  });
});
