# v2.10 — Scale: proving the product at enterprise volume

> **Status:** Proposed — awaiting approval before build.
> **Baseline:** prod at `d36f92b` (v2.9), all nine milestones shipped, four test lanes green.
> **Why now:** every functional gap v2.4 left open is closed. The largest untested
> claim left is the one on the front page — that this manages an *enterprise's*
> assets. Nobody has ever run it at that size.

## 1. Goal

Production today holds **15 assets, 107 audit rows and zero stock movements**. Every
performance figure this project has ever quoted was measured against data that size.
That is not a criticism of the figures; it is a statement about what they mean, which
is very little.

The evidence that this matters is already in the code:

- **~80 `findMany` calls, many unbounded.** `listLevels`, `listItems`, `listBatches`,
  `listLocations` and others return *every* matching row to the client. At 200 rows that
  is invisible. At 200,000 it is a multi-megabyte response and an out-of-memory risk on
  both ends.
- **A per-row N+1 in the nightly sweep.** `runStockSweep` loads every stock level, then
  for each one loads *every movement ever recorded* for that item/location pair and sums
  it to check for drift. At real volume this is not slow, it is unfinishable.
- **The audit log is append-only and undeletable by design.** That is the right call for
  trust and the wrong shape for growth, and nothing currently answers what happens when
  it reaches ten million rows.

None of this is hypothetical or blocked on anybody: it can be generated, measured and
fixed here.

## 2. In / out

**In**
- **A data generator and a load rig** — one command produces a defensible "large tenant"
  (100k assets, 1M stock movements, 2M audit rows, 5k users), and a k6 suite drives the
  hot paths against it. The rig is the deliverable that makes every other claim provable.
- **Bounded reads everywhere** — every list endpoint is paginated or explicitly capped,
  with a guard test that fails the build when a new unbounded query appears on a
  tenant-scaled table.
- **Sweeps that scale** — the drift check becomes one grouped query instead of N; every
  nightly job is bounded and its runtime measured at volume.
- **Indexes from evidence** — `EXPLAIN (ANALYZE, BUFFERS)` on the hot paths at volume,
  indexes added where the plan says so and nowhere else, each with a before/after number.
- **Exports that stream** — reports build incrementally rather than assembling the whole
  result set in memory.
- **An answer for audit growth** — measured cost at volume, then partitioning or archival,
  whichever the numbers justify. The append-only guarantee is not weakened.

**Out (honestly):** the vendor self-service portal, multi-currency, billing, e-signatures,
hash-chained audit, PITR/WAL archiving, a DR region, live Intune/IdP verification, mobile
device CI, and the `companyId → tenantId` rename.

## 3. Invariants

1. **A performance claim comes with a number and the volume it was measured at, or it is
   not made.** This release exists because that rule was not applied before.
2. **No endpoint returns an unbounded number of rows.** Pagination or an explicit,
   documented cap — and a test that enforces it for future code.
3. **Nothing that scales with tenant data runs a query per row.** One query, or a bounded
   batch with the bound stated.
4. **Correctness is not traded for speed.** Every existing test stays green; any
   optimisation that changes a result is a bug, and the suites are the proof.
5. **The audit log stays append-only and undeletable.** Growth is managed by partitioning
   or archival, never by making rows disappear.
6. **The rig is repeatable by anyone** — one command, deterministic, documented.

## 4. Permissions

None. This release adds no user-facing capability, so it adds no permission keys — and
therefore **no seed re-run**, and no APK rebuild unless a mobile query changes.

## 5. Workstreams

| WS | Scope |
|---|---|
| **S1 Rig** | Deterministic large-tenant generator + k6 scenarios for the hot paths; documented baseline numbers before a single fix |
| **S2 Bounded reads** | Every list endpoint paginated or capped; a guard test that fails when a new unbounded query lands on a tenant-scaled table |
| **S3 Sweeps** | Kill the per-row N+1 in the stock drift check; bound every nightly job; measured runtime at volume |
| **S4 Plans & indexes** | EXPLAIN the hot paths at volume; add only the indexes the plans justify; before/after p95 per change |
| **S5 Exports** | Streaming report generation; a large export proven not to grow memory without bound |
| **S6 Audit growth + QA** | Measure, then partition or archive; QA scorecard with the full before/after table |

Sequencing: S1 → (S2 ∥ S3 ∥ S4) → S5 → S6. S1 first is not negotiable: without the rig,
every later claim is another unmeasured assertion.

## 6. Acceptance criteria

1. One command produces the large tenant, repeatably, and the rig reports **baseline**
   p95s for every hot path *before* any optimisation.
2. At that volume, every list endpoint returns within **p95 < 300 ms** and never more than
   one page of rows; the dashboard within **p95 < 800 ms**.
3. The nightly sweep completes at that volume in **under 5 minutes**, with the figure
   printed, and the drift check issues **one query, not one per stock level**.
4. A 100k-row report exports without unbounded memory growth, proven by a measured
   high-water mark rather than by it not crashing once.
5. Audit growth has a measured cost and an implemented answer; append-only and
   undeletable both still hold, proven by the existing suites.
6. Zero regression across all four lanes, and every optimisation lands with its
   before/after number in the scorecard.

## 7. Risks

- **Optimisation that quietly changes results** is the real danger here, not slowness.
  Mitigated by treating the existing suites as the contract: they run unchanged, and any
  diff in behaviour is a defect rather than a trade-off.
- **Index sprawl** — indexes are not free on write. Only plan-justified indexes ship, each
  with the query it serves recorded next to it.
- **The rig is a big dataset on a small dev box.** It is generated locally and never
  loaded into production; the VPS is measured only by the existing lightweight probe.
- **Estimate:** comparable to v2.8 in size (~6 PRs), with more measurement than code.

## 8. Phase gate

Standard: typecheck, all four lanes green, lint clean, QA scorecard on the epic with the
before/after table, then **STOP for explicit approval before deploy**.

---

### Still waiting on credentials (not code, not this release)

- **Off-site backups** need `BACKUP_S3_*`. Production still publishes "the local copy is
  the only copy" about itself. Unchanged since v2.8, and still the largest operational
  risk in the system.
- **Tracing** needs an OTLP collector endpoint — which, notably, is exactly the tool that
  would make this release's measurements continuous rather than one-off.
