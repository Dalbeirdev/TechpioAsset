# v2.9 QA scorecard — Procurement & Inventory Completion

**Verdict: PASS for the committed scope.**

v2.7 and v2.8 were infrastructure releases. v2.9 went back to the parts of the
product people actually touch, and closed the four deferrals v2.4 made on
purpose — most pointedly the one that made somebody re-type every delivery into
the asset register by hand.

Suite at close: **82 unit + 408 integration + 7 RLS-lane + 2 throttle-lane = 499
API tests**, plus 313 domain / 14 contracts / 61 ui-tokens / 8 web / 25 mobile.
All green; `tsc`, `eslint` and `next build` clean across the workspace.

## Acceptance criteria, and how each was actually proven

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Receiving 3 units of an ASSET line creates exactly 3 assets linked to the GRN line; re-posting creates none | **PASS** (see note) | 3 units → exactly 3 assets, distinct tags and QR tokens, vendor/PO/cost/currency carried, each linked to its receipt line. Re-posting a completed receipt is refused and the count is unchanged; **the unique index was then attacked directly** — a hand-written duplicate insert is refused by the database, so idempotency does not depend on the service remembering to check |
| 2 | Two PRs racing for the last of a budget: exactly one commits, the other refused with remaining/committed/requested | **PASS** | Two approvers racing the last 250 → `[201, 409]`, budget lands on exactly its limit with two commitments, not three. A **six-way storm** on room for three → exactly three winners, 100% utilisation. The refusal carries all four figures: requested, remaining, committed-of-limit, shortfall |
| 3 | Rejecting or cancelling a committed PR releases its budget, provably | **PASS** (see note) | Cancelling returns the commitment and audits the figure; **cancelling twice releases once** (`[201, 409]`, budget still 0); cancelling the PO that has received nothing releases the request that paid for it |
| 4 | Awarding a quote creates a PO from that quote; converting a losing quote is refused | **PASS** | The PO carries **the quoted 1,250, not the estimated 1,200**, and links back to the winning quote. A losing quote is refused naming the winner; so is naming the losing vendor directly; neither attempt ordered anything. Two buyers racing to award different vendors → exactly one winner. **The CHECK constraint was attacked directly** — a raw update pointing a losing quote at a real order is refused by the database |
| 5 | Issuing consumes earliest expiry first; expired stock without a reason is refused, and with one is recorded | **PASS** | Issuing 8 drained the 10-day lot (6) then the 90-day lot (2), one ledger row per lot. Issuing 20 against 13 usable + 100 expired is refused with **both** numbers separated. With a reason: 13 usable first, then 7 expired — audited separately, and the movement row says so. The negative-quantity CHECK was attacked directly |
| 6 | Zero regression across all four lanes; live web demo; deploy checklist including the seed re-run | **PASS** | Every pre-existing suite green. The web demo was **clicked through end to end on the running stack**, not asserted — see below |

### Note on criterion 1 — "draft" assets

The plan said assets arrive as *drafts*. They arrive as **`RECEIVED`**, which is
already in the asset state machine and says the same thing more precisely: the
kit is in the building, and nobody has checked, configured or tagged it yet.
`DRAFT` would have implied the receipt itself was provisional, which it is not —
the receipt is an append-only fact.

### Note on criterion 3 — "rejecting"

A committed request cannot be *rejected*, because commitment happens at approval
and the state machine has no `APPROVED → REJECTED` edge. The two real release
paths are therefore cancelling the request and cancelling the order it became,
and both are proven. Nothing was weakened to make the criterion pass.

## The live web demo, step by step

Run against the local stack with the real API, in the browser — each step's
result read back off the page:

1. Cost centre and a 25,000 USD budget created **through the UI** → `0 / 25,000 USD · 0%`
2. Request charged to it, approved → budget shows **2,400 committed / 22,600 remaining / 9.6%**; the request shows "Holding against the budget · 2,400"
3. Two quotes recorded → Apple Business *fastest* `2,500 · 4 days · +300`, Dell *cheapest* `2,200 · 28 days`, plus the cheapest-is-not-fastest warning
4. Awarded through the UI with a reason → Apple `Awarded`, Dell `Lost`, reason on the record
5. Converted → the order carries **the quoted 1,250** and Apple as vendor
6. Issued, then received 2 units with serials → **two assets created**, listed with their serials and their provisional tags

## Design decisions worth recording

- **Idempotency is a database guarantee, not a code convention.** The receipt
  line plus the unit's position within it is the asset's identity and carries a
  unique index. A rule enforced only by the code that usually runs is a rule
  with a hole in it — so every invariant in this release has a constraint behind
  it, and every constraint was attacked directly in a test.
- **Permission to fall back on expired stock is not an instruction to reach for
  it.** Expired lots sort *earliest* by expiry, so the first implementation
  handed them out preferentially the moment somebody gave the override. Caught
  by a domain test written before the integration test existed.
- **A budget refusal states four numbers.** "Budget exceeded" tells nobody what
  to do; requested / remaining / committed-of-limit / shortfall does.
- **The award reason is required and free text.** A dropdown would have made the
  record cheaper to produce and worthless to read.
- **Document numbers are allocated under an advisory lock.** Found by the budget
  concurrency proofs: PR/PO numbers were a `max()+1` scan, so two people raising
  a request in the same instant collided and one got a raw uniqueness error. A
  latent v2.4 defect that only a concurrency test was ever going to surface.
- **Charging is optional.** A company with no cost centres sees none of this and
  behaves exactly as it did in v2.4 — budgets are additive, not a rewrite.

## Open, honestly

| Gap | Status |
|---|---|
| **The mobile app was not run on a device** | No emulator or handset in the build environment. Verified: typecheck, lint, 7 new payload-shaping tests, and the API endpoints those payloads hit. Not verified: the screens on real hardware. **Needs a look after the APK rebuild** |
| Mobile receiving was broken between C1 and C5 | C1 made ASSET intake require a category; mobile sent none and got a 422 for four commits. Fixed in C5 and now covered by tests. It never reached production — v2.9 has not deployed |
| Pre-v2.9 receipts are not backfilled | ASSET lines received before this release do not retroactively create assets. Deliberate: inventing asset records for deliveries somebody already typed in by hand would duplicate them |
| Multi-currency | A budget and the requests charged to it are assumed to share a currency; no conversion is performed. Out of scope, unchanged |
| Vendor self-service portal | Quotes are recorded by staff from whatever the vendor sent. The portal remains its own project |
| Off-site backups live in production | **Still needs credentials.** `BACKUP_S3_*` is unset, so the local copy is the only copy. Unchanged by this release and still the largest operational risk |
| Tracing live in production | Ships opt-in; no OTLP collector configured |
| PITR / WAL archiving, DR region, load rig, hash-chained audit, e-signatures | Blueprint-future, unchanged |

## Deploy notes

- **Seed re-run REQUIRED** — the first since v2.6. Two new permission keys
  (`finance:budgets:manage`, `procurement:rfq:manage`), and the seed now also
  marks toner and batteries lot-tracked so the demo tenant can exercise expiry.
- **APK rebuild REQUIRED** — mobile changed (category picker + serial capture).
- **Five migrations**, all additive: assets-from-receipts, budgets and cost
  centres, budget audit actions, RFQ and award, stock batches and expiry.
- **No new environment variables.**
- Run `deploy/preflight.sh` before deploying — that is the point of it.
- **Behaviour change to announce:** ASSET intake now requires a category.
  Anyone receiving ASSET lines today gets nothing created, so nothing working
  breaks — but the request shape changed and the mobile app must be updated
  alongside the API.
