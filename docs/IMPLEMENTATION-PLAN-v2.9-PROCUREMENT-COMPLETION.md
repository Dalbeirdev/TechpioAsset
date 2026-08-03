# v2.9 — Procurement & Inventory Completion

> **Status:** Proposed — awaiting approval before build.
> **Baseline:** prod at `9a775c3` (v2.8), RLS enforcing, four test lanes green.
> **Why now:** v2.7 and v2.8 were infrastructure releases. The largest remaining
> *user-facing* gaps are the pieces v2.4 deliberately cut from procurement — including
> one that still makes people do work the system should do for them.

## 1. Goal

v2.4 shipped PR → PO → GRN with real guarantees, and explicitly deferred RFQ, budgets,
cost centres, batch tracking and asset creation from receipts. Those deferrals are now the
sharpest edges in daily use:

- **Receiving a laptop does not create the laptop.** `ASSET` intake lines are recorded and
  then skipped, so somebody re-types every delivery into the asset register. This is the
  most-used loop in the product and it has a manual step in the middle of it.
- **Nothing stops a department overspending**, because there is no budget to spend against
  — only a Finance-approval threshold per request.
- **Competitive quoting happens in email**, so "why this vendor at this price?" has no
  answer inside the system that just approved the purchase.
- **Consumables have no batch or expiry**, so toner, batteries and anything perishable are
  a single undifferentiated pile.

## 2. In / out

**In**
- **Assets from receipts** — an `ASSET`-intake GRN line creates draft assets in the same
  transaction as the receipt, with serial capture, linked back to the PO line and the GRN.
  Idempotent: receiving twice never creates a second asset for the same receipt line.
- **Budgets & cost centres** — a `Budget` per cost centre and period; a PR charges one; the
  approval path checks committed-plus-requested against remaining budget and refuses with
  the real numbers. Same proven pattern as licence seats: an atomic conditional reserve, a
  DB CHECK backstop, and an honest refusal.
- **RFQ & award** — request quotes from vendors against an approved PR, record responses,
  award one with a reason; the PO is created from the winning quote and carries the link.
- **Batches & expiry** — optional lot tracking on stock items: receive into a batch, issue
  FIFO by expiry, refuse expired stock without an explicit reason, and alert before expiry.
- **PR attachments and cost-centre reporting**, plus the web surfaces for all of the above
  and the mobile receive flow gaining serial capture.

**Out (honestly):** the vendor self-service portal (its own project), multi-currency,
billing, e-signatures, hash-chained audit, PITR/WAL archiving, a DR region, load rigs, and
the `companyId → tenantId` rename.

## 3. Invariants

1. **A budget is a hard limit, not a warning.** Committing against it is an atomic
   conditional update whose WHERE clause is the limit; a refusal states remaining, committed
   and requested, and takes nothing.
2. **Assets from receipts are idempotent.** The GRN line is the identity: re-running,
   retrying or double-clicking creates no duplicate asset.
3. **A losing quote can never become a PO.** Only the awarded quote converts, and the award
   carries a reason and an audit row.
4. **Expired stock is never issued silently.** It can be issued with an explicit reason, and
   that reason is recorded — the same shape as the invoice-match override.
5. **Batch issue is FIFO by expiry**, so the oldest usable stock leaves first, provably.
6. **Everything remains ledger-first**: batches are a dimension of the existing movement
   ledger, not a parallel truth.

## 4. Permissions

New keys: `procurement:rfq:manage` (raise/record/award quotes), `finance:budgets:manage`
(create and adjust budgets). Budget *visibility* rides on the existing `assets:cost:read`
rule, since a budget is a money figure. Matrix: PROCUREMENT_MANAGER gets RFQ; FINANCE gets
budgets. **Seed re-run required at deploy** (the first since v2.6).

## 5. Workstreams

| WS | Scope |
|---|---|
| **C1 Assets from receipts** | ASSET-intake creates draft assets in the receipt transaction, serial capture, idempotency keyed on the GRN line, back-links |
| **C2 Budgets & cost centres** | Budget/CostCentre entities + domain math; PR charges a cost centre; guarded commit with honest refusal; release on rejection/cancellation |
| **C3 RFQ & award** | Quote request/response entities, award with reason, PO created from the winning quote, losing quotes provably inert |
| **C4 Batches & expiry** | Optional lot tracking, FIFO-by-expiry issue, expired-stock refusal with reasoned override, pre-expiry alert in the sweep |
| **C5 Web + mobile** | Receiving with serials, budget consumption on the PR screens, RFQ compare/award, batch views; mobile receive gains serial capture |
| **C6 QA close-out** | Concurrency proofs for budgets, idempotency proof for asset creation, QA scorecard, docs |

Sequencing: C1 ∥ C2 → C3 → C4 → C5 → C6.

## 6. Acceptance criteria

1. Receiving 3 units of an ASSET line creates exactly 3 draft assets, linked to the GRN
   line; re-posting the same receipt creates none.
2. Two PRs racing for the last of a budget: exactly one commits, the other is refused with
   remaining/committed/requested; the budget is never overcommitted.
3. Rejecting or cancelling a committed PR releases its budget, provably (committed returns
   to its prior figure).
4. Awarding a quote creates a PO from that quote; attempting to convert a losing quote is
   refused.
5. Issuing from batches consumes the earliest expiry first; issuing expired stock without a
   reason is refused, and with one is recorded.
6. Zero regression across all four test lanes; live web demo; deploy checklist **including
   the seed re-run**.

## 7. Risks

- **Budgets touch the approval path**, which is load-bearing. Mitigated by keeping the
  existing threshold behaviour intact when a PR has no cost centre — budgets are additive,
  not a rewrite.
- **Auto-created assets could surprise people** if they appear as active kit. They are
  created as drafts requiring completion, which is also how stock→asset conversion behaves.
- **Estimate**: larger than v2.8, comparable to v2.4 (~7 PRs).

## 8. Phase gate

Standard: typecheck, all four lanes green, lint clean, QA scorecard on the epic, live web
verification, then **STOP for explicit approval before deploy**.

---

### Still waiting on credentials (not code, not this release)

- **Off-site backups** need `BACKUP_S3_*`. Until then a host loss loses the data and its
  backups together — the largest remaining operational risk, and one config block from closed.
- **Tracing** needs an OTLP collector endpoint.
