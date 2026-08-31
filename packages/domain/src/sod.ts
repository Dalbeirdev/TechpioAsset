import { PERMISSIONS, type Permission } from './permissions';

/**
 * Segregation-of-duties (SoD) conflict catalogue — v2.2 Workstream G.
 *
 * A conflict names two permissions that, held together, let one person both
 * originate and sanction the same class of transaction. Combining them is not
 * forbidden — a small company may accept the risk knowingly (and Super Admin
 * always holds everything) — so these power WARNINGS at configuration time,
 * never hard blocks. The one hard SoD rule remains at decide time: nobody
 * approves their own request (BR-04, canApproveStep).
 */

export interface SodConflict {
  /** Stable identifier, e.g. `request-self-approval`. */
  id: string;
  a: Permission;
  b: Permission;
  /** Why holding both is risky — shown verbatim to the admin. */
  reason: string;
}

const P = PERMISSIONS;

export const SOD_CONFLICTS: readonly SodConflict[] = [
  {
    id: 'request-and-approve',
    a: P.REQUESTS_CREATE,
    b: P.REQUESTS_APPROVE,
    reason:
      'Can raise equipment requests and approve them. Request approval should sit with a different person than the requester.',
  },
  {
    id: 'approve-on-behalf',
    a: P.REQUESTS_CREATE_ON_BEHALF,
    b: P.REQUESTS_APPROVE,
    reason:
      'Can raise requests on behalf of others and approve them — a route around the self-approval block.',
  },
  {
    id: 'price-and-approve',
    a: P.ASSETS_COST_READ,
    b: P.INVOICES_VERIFY,
    reason:
      'Can see and set asset cost and give financial sign-off on invoices. Pricing and verification should be separated.',
  },
  {
    id: 'upload-and-verify-invoices',
    a: P.INVOICES_UPLOAD,
    b: P.INVOICES_VERIFY,
    reason:
      'Can enter invoices and verify them. The person recording a bill should not also confirm it for payment.',
  },
  {
    id: 'correct-and-verify-invoices',
    a: P.INVOICES_CORRECT_EXTRACTION,
    b: P.INVOICES_VERIFY,
    reason:
      'Can edit extracted invoice figures and then verify the result, so one person controls both the numbers and the sign-off.',
  },
  {
    id: 'purchase-and-verify',
    a: P.PURCHASE_ORDERS_MANAGE,
    b: P.INVOICES_VERIFY,
    reason:
      'Can raise purchase orders and verify the resulting invoices — the classic ordering/payment conflict.',
  },
  {
    id: 'dispose-and-adjust-stock',
    a: P.ASSETS_DISPOSE,
    b: P.INVENTORY_ADJUST,
    reason:
      'Can write assets off and adjust stock counts, which together can hide missing equipment.',
  },
  {
    id: 'act-and-audit',
    a: P.ASSETS_UPDATE,
    b: P.AUDIT_READ,
    reason:
      'Can change asset records and read the audit trail. Auditing is most trustworthy when done by someone who cannot alter what is audited.',
  },
  /**
   * v2.30 - bulk import is a second route to altering asset records, and the
   * catalogue did not know about it.
   *
   * A spreadsheet upload writes names, types, condition, status, assignment and
   * price across the estate at once. That is materially `assets:update` applied
   * to many rows, but it is a different permission, so the two pairs below had
   * to be stated separately: a SodConflict names exactly two permissions and
   * cannot express "either of these, with that".
   *
   * The gap was not hypothetical. Finance holds audit:read and assets:dispose
   * and NO assets:update, so it tripped neither existing rule while being able
   * to write assets off and read the trail - and once given assets:import it
   * could rewrite the records too.
   */
  {
    id: 'import-and-audit',
    a: P.ASSETS_IMPORT,
    b: P.AUDIT_READ,
    reason:
      'Can rewrite asset records in bulk from a spreadsheet and read the audit trail. Auditing is most trustworthy when done by someone who cannot alter what is audited.',
  },
  {
    id: 'import-and-dispose',
    a: P.ASSETS_IMPORT,
    b: P.ASSETS_DISPOSE,
    reason:
      'Can write assets off and rewrite asset records in bulk, which together can make disposed equipment look accounted for.',
  },
  {
    id: 'manage-roles-and-approve',
    a: P.ROLES_MANAGE,
    b: P.REQUESTS_APPROVE,
    reason:
      'Can grant themselves or others approval rights and exercise them. Role administration and approval authority should be separated.',
  },
  {
    id: 'buy-licences-and-verify-invoices',
    a: P.LICENSES_CREATE,
    b: P.INVOICES_VERIFY,
    reason:
      'Can record licence purchases and verify the invoices that pay for them — the ordering/payment conflict applied to software.',
  },
  {
    id: 'receive-and-verify-invoices',
    a: P.PROCUREMENT_RECEIVE,
    b: P.INVOICES_VERIFY,
    reason:
      'Can receive goods and verify the invoices that pay for them. The person at the loading dock should not also clear the bill.',
  },
];

/** Conflicts triggered by one set of permissions (e.g. a single role's grants). */
export function findSodConflicts(permissions: readonly string[]): SodConflict[] {
  const held = new Set(permissions);
  return SOD_CONFLICTS.filter((c) => held.has(c.a) && held.has(c.b));
}

/**
 * Conflicts a user would hold across ALL their roles combined — the union
 * matters: two individually-clean roles can conflict when granted together.
 */
export function findSodConflictsAcross(roles: readonly (readonly string[])[]): SodConflict[] {
  return findSodConflicts(roles.flat());
}
