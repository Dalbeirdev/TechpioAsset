# TechpioAsset — v2.4 Implementation Plan: Procurement & Warehouse Inventory

> **Parent plan:** [IMPLEMENTATION-PLAN-v2.1.md](./IMPLEMENTATION-PLAN-v2.1.md) §3/§5 — the release map's
> **v2.4 = Procurement & Inventory (blueprint Phase 2)**. Source spec: blueprint Volume III (Procurement &
> Inventory Modules). **Prerequisites shipped:** v2.1–v2.3 are live, including the Licence module whose
> patterns (atomic counters, append-only history, honest refusals) this release reuses.

## 1. Goal

Close the loop from "we need to buy something" to "it is on the shelf / on a desk, and the invoice matches
what we ordered and received": Purchase Requests with approval, Purchase Orders issued to vendors, Goods
Receipts against those orders (partial deliveries included), a **three-way match** (PO ↔ GRN ↔ invoice) that
gates invoice verification, and a real warehouse layer — locations, per-location stock levels, an
**append-only movement ledger**, transfers, and stock→asset conversion.

## 2. Starting point (what v1–v2.3 already give us)

- `PurchaseOrder` + `PurchaseOrderLine` with the full status enum (DRAFT→ISSUED→PARTIALLY_RECEIVED→RECEIVED→CANCELLED/CLOSED) — but nothing *drives* those transitions today.
- `InventoryItem` with quantities, min-stock/reorder levels, unit costs — but a single implicit location and no movement history.
- `PhysicalInventorySession`/`Scan` — mobile, offline-capable cycle counts (keep; wire to locations).
- Invoice module with verification + `LOW_STOCK` notification type — the match result plugs in here.
- The approval workflow engine, SoD rules, and the sweep/notification infrastructure.

## 3. Scope

**In (v2.4):**
- **Purchase Requests** (`PurchaseRequest` + lines): DRAFT→SUBMITTED→APPROVED/REJECTED→CONVERTED;
  single-step approval honouring SoD (submitter ≠ approver) with a Finance threshold (reusing the
  BR-05-aligned inclusive boundary), convert-to-PO.
- **PO lifecycle**: issue, cancel, create-from-PR; status rollup driven by receipts.
- **Goods Receipts** (`GoodsReceipt` + lines): receive against PO lines, partial deliveries accumulate,
  over-receipt refused (guarded, like seats); receipt posts stock into a location **or** creates draft
  assets (per line's intake kind).
- **Three-way match**: pure domain logic comparing PO line qty/price ↔ received qty ↔ invoice totals within
  a tolerance; result stored per invoice and surfaced in verification (mismatch blocks approval with honest
  numbers, override audited).
- **Warehouse inventory**: `StockLocation` (per office/warehouse), `StockLevel` per (item, location) with
  reserved qty, **append-only `StockMovement` ledger** (RECEIPT/ISSUE/ADJUST/TRANSFER_IN/TRANSFER_OUT/
  COUNT_CORRECTION/CONVERT_TO_ASSET), transfers between locations, reserve/release, stock→asset conversion;
  cycle-count corrections post to the ledger.
- Web + mobile surfaces, notifications (PO issued, GRN received, match mismatch, low stock per location),
  QA `PRC-*` / `INV-*` runs.

**Out (later, honestly):** RFQ/quotations & vendor awards, vendor portal, shipments/carrier tracking,
budgets & commitments (the release map's "budget gate" reduces to the PR Finance threshold in v2.4 — a
dedicated Budget entity needs its own slice), batch/serial-tracked stock batches, multi-currency valuation.

## 4. Invariants (the licence-module discipline applied to stock)

1. **The ledger is the truth.** `StockLevel.quantity` is a cached rollup; every change goes through a
   movement row; the nightly sweep reconciles cache↔ledger and WARNs on drift, never silently repairs.
2. **No negative stock, no over-receipt.** Issue/transfer/convert are atomic conditional updates
   (`WHERE quantity - :n >= reserved`); GRN lines are guarded by `received + :n <= ordered` per PO line.
   Refusals are 409s with honest numbers.
3. **Append-only receipts and movements** — corrections are new rows, never edits.
4. **SoD:** PR submitter cannot approve their own PR (hard block, like BR-04); `procurement:receive` and
   `invoices:verify` form a new SoD warning pair (receiver shouldn't clear the bill).

## 5. Permissions

New keys: `procurement:pr:create/read/approve/convert`, `procurement:po:issue`, `procurement:receive`,
`inventory:locations:manage`, `inventory:transfer`, `inventory:convert` (existing `inventory:read/adjust`,
`purchase-orders:read/manage` keep working). Matrix: PROCUREMENT_MANAGER gets the procurement set;
INVENTORY_MANAGER the warehouse set + receive; FINANCE approves above-threshold PRs + match override;
AUDITOR read-only; EMPLOYEE may create PRs. Seed re-run required at deploy (the v2.3 lesson).

## 6. Workstreams

| WS | Deliverable |
|---|---|
| **P1 Domain + schema** | Entities + enums + additive migrations with guard SQL (CHECKs, RLS on all new tables); `packages/domain/src/{procurement,stock}.ts` — PR status machine, receipt math, match logic, movement math — unit-tested pure |
| **P2 Procurement API** | `procurement` module: PR CRUD/submit/approve (SoD + threshold)/convert-to-PO; PO issue/cancel; GRN receive with partial rollup + over-receipt guard; audit + notifications |
| **P3 Match engine + proofs** | Three-way match wired into invoice verification (mismatch blocks, audited override); QA `PRC-*` runs incl. the over-receipt race (two receivers, last unit) |
| **P4 Inventory API** | `stock` module: locations, levels, movement ledger, adjust/issue/transfer/reserve/release, stock→asset conversion; cycle-count correction posting; low-stock-per-location notifications |
| **P5 Web UI** | Procurement pages (PRs + approve, POs + receive, match panel on invoices) and Inventory pages (locations, stock levels + ledger, transfer/adjust dialogs) |
| **P6 Mobile** | Receive-GRN flow and stock-by-location views; count sessions keep working against locations |
| **P7 Jobs + QA close-out** | Ledger-drift sweep, low-stock sweep per location; QA `INV-*` runs; docs + deploy checklist |

Sequencing: P1 → P2 → P3 strictly; P4 after P1 (parallel with P2/P3); P5/P6/P7 after their APIs.
Cadence: small PRs into a `v2.4` branch → one integration PR → deploy.

## 7. Acceptance criteria (traced)

1. PR lifecycle with SoD self-approval block + Finance threshold at the inclusive boundary (PRC-001..007).
2. PO issued from an approved PR carries its lines; receipts accumulate; over-receipt refused with honest
   numbers; PO rolls PARTIALLY_RECEIVED→RECEIVED exactly when all lines complete (PRC + INV-01x).
3. Three-way match: within-tolerance passes; qty or price mismatch blocks verification with the numbers;
   override requires permission and writes an audit row (INV-02x / PRC).
4. Ledger: every stock change has a movement row; cache==Σledger proven; negative-stock and reserve races
   refused under concurrency (the licence-style storm test) (INV-04x/05x).
5. Stock→asset conversion decrements stock atomically and creates the draft asset in one transaction.
6. Zero v1 regression; purely additive; full suite green; live web demo (PR→PO→GRN→match) + mobile evidence.
7. Deploy checklist: containers + **seed re-run** + APK rebuild + outside-in verification.

## 8. Risks

- **Scope creep** — procurement invites it; the §3 "Out" list is the contract. RFQ/budgets ship later.
- **Ledger/cache drift** — same mitigation as seats: conditional updates + nightly reconciliation WARN.
- **Match false-positives** — tolerance configurable per company later; v2.4 uses a fixed 2% / absolute-0.01
  tolerance documented in domain code.
- **Estimate**: the largest release since v2.1 — roughly 7 PRs (~1.5× v2.3).

## 9. Phase gate

Standard exit: typecheck 9/9, full suites green (637 baseline + new coverage), lint clean, QA report on the
epic, live demo, then **STOP for explicit approval before deploy** (containers + seed + APK + outside-in).
