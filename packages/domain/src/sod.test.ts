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

/**
 * v2.30 - bulk import as a route to altering asset records.
 *
 * These assert the gap the pairs were added to close, not merely that the pairs
 * exist. Finance is the case that made it visible: it holds audit:read and
 * assets:dispose but no assets:update, so it tripped neither `act-and-audit`
 * nor `dispose-and-adjust-stock` while being able to write equipment off - and
 * once granted assets:import it could rewrite the records as well.
 */
describe('bulk import counts as altering asset records', () => {
  it('flags import alongside audit access', () => {
    const hits = findSodConflicts([P.ASSETS_IMPORT, P.AUDIT_READ]);
    expect(hits.map((c) => c.id)).toContain('import-and-audit');
  });

  it('flags import alongside disposal', () => {
    const hits = findSodConflicts([P.ASSETS_IMPORT, P.ASSETS_DISPOSE]);
    expect(hits.map((c) => c.id)).toContain('import-and-dispose');
  });

  it('does not flag import on its own', () => {
    // Importing is an ordinary job. It is the combination that is the risk, and
    // a warning that fires on the permission alone would be ignored on sight.
    expect(findSodConflicts([P.ASSETS_IMPORT])).toHaveLength(0);
  });

  it('now flags Finance, which held both routes and tripped neither rule', () => {
    const ids = findSodConflicts(ROLE_PERMISSIONS.FINANCE).map((c) => c.id);
    expect(ids).toContain('import-and-audit');
    expect(ids).toContain('import-and-dispose');
    // The pre-existing rules genuinely did not cover it: Finance holds no
    // assets:update and no inventory:adjust, which is why the gap was silent.
    expect(ids).not.toContain('act-and-audit');
    expect(ids).not.toContain('dispose-and-adjust-stock');
  });

  it('leaves the read-only roles clean', () => {
    // Neither holds import, so the new pairs must not have caught them - a
    // conflict on a read-only role would mean the catalogue had gone wrong.
    expect(findSodConflicts(ROLE_PERMISSIONS.AUDITOR)).toHaveLength(0);
    expect(findSodConflicts(ROLE_PERMISSIONS.EMPLOYEE)).toHaveLength(0);
  });
});
