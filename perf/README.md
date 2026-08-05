# The performance rig (v2.10)

Every performance figure this project quoted before v2.10 was measured against a
tenant holding **15 assets and zero stock movements**. Those figures were not
wrong; they simply did not mean anything about an enterprise. This directory is
the apparatus that makes the numbers mean something.

The governing rule for this release: **a performance claim comes with a number
and the volume it was measured at, or it is not made.**

## What is here

| File | What it does |
|---|---|
| `../apps/api/prisma/perf/generate-load-tenant.ts` | Builds the large tenant. Generated *inside* Postgres, deterministic, idempotent, refuses to run against anything non-local |
| `load-probe.mjs` | Measures the hot paths against that tenant and writes a JSON baseline for later comparison |
| `baselines/*.json` | Committed measurements. `baseline.json` is the state before any v2.10 optimisation |
| `probe.mjs` | The older demo-scale probe (v2.1). Kept — it is still the right tool for a smoke check |
| `k6-smoke.js` | k6 scenario. k6 is not installed on the build machine, which is why `load-probe.mjs` is dependency-free |

## Running it

```bash
# 1. Local Postgres and a seeded demo tenant must exist first. The rig copies a
#    real password hash from admin@techpioasset.dev so its users can log in;
#    without the seed it fails loudly rather than writing an unusable hash.
cd apps/api && pnpm db:local &
pnpm seed

# 2. Build the large tenant: 100k assets, 1M stock movements, 2M audit rows,
#    5k users. Takes about 2.5 minutes; --scale 0.02 for a quick check.
pnpm --filter @techpioasset/api perf:generate

# 3. Start the API WITH THE RATE LIMITER RAISED (see below).
cd apps/api && RATE_LIMIT_MAX=1000000 LOGIN_RATE_LIMIT=100000 pnpm dev

# 4. Measure.
node perf/load-probe.mjs --label baseline
node perf/load-probe.mjs --label after-s2 --compare baseline

# 5. Remove it when done — it shares a database with the test suites.
pnpm --filter @techpioasset/api perf:generate -- --drop
```

## Why the rate limiter has to be raised

The API allows **120 requests per 60 seconds**. The probe fires 14 endpoints ×
60 requests = 840. Left alone, most of the run is rejected and the probe measures
the rate limiter rather than the endpoints.

The first version of the probe counted those rejections as endpoint errors and
printed `60 ERRORS` next to `/assets?q=`, which reads exactly like a broken
endpoint. It was not. **The probe now aborts** on any 401, 403 or 429 with the
reason and the fix, and refuses to write a baseline file from a contaminated
run — a wrong number that gets committed and compared against later is worse
than no number.

## Baseline — 2026-08-05, before any v2.10 change

100k assets · 1M stock movements · 2M audit rows · 5k users. 60 requests per
endpoint, concurrency 6, local dev machine. Targets: **300 ms** p95 for lists,
**800 ms** for aggregates.

| Endpoint | Kind | p50 | p95 | Largest response | |
|---|---|---|---|---|---|
| `GET /stock/levels` | unbounded | 255 ms | **348 ms** | **589 KB** | over |
| `GET /stock/items` | unbounded | 101 ms | 128 ms | 280 KB | ok |
| `GET /stock/batches` | unbounded | 14 ms | 19 ms | 0 KB | ok |
| `GET /stock/locations` | unbounded | 13 ms | 19 ms | 6 KB | ok |
| `GET /assets` page 1 | paged | 135 ms | 215 ms | 20 KB | ok |
| `GET /assets` page 1000 | paged | 191 ms | 283 ms | 20 KB | ok |
| `GET /assets?q=` | paged | 168 ms | 211 ms | 20 KB | ok |
| `GET /assets?status=` | paged | 30 ms | 35 ms | 20 KB | ok |
| `GET /stock/movements` | paged | 120 ms | 159 ms | 7 KB | ok |
| `GET /audit` | paged | 853 ms | **1999 ms** | 6 KB | **over by 6.7×** |
| `GET /dashboard` | aggregate | 22 ms | 56 ms | 1 KB | ok |
| `GET /analytics/overview` | aggregate | 8 ms | 141 ms | 1 KB | ok |
| `GET /analytics/spend` | aggregate | 9 ms | **2798 ms** | 1 KB | **over by 3.5×** |
| `GET /auth/me` | control | 9 ms | 13 ms | 2 KB | ok |

### What the baseline says

- **`/audit` is the worst read path.** 2 million rows, paginated, and still two
  seconds at p95. Paginating the *output* did nothing for the cost of finding
  the page. S4's first EXPLAIN.
- **`/analytics/spend` has a p50 of 9 ms and a p95 of 2798 ms.** That shape is a
  cache: nearly every request is served warm, and the few cold ones pay for
  everything. A p50 quoted alone here would be flattering and useless.
- **`/stock/levels` returns 589 KB for 2,000 rows** and is the only unbounded
  endpoint already over target. It grows linearly with the tenant, and 2,000
  levels is small — a real warehouse estate is far past that. S2.
- **Pagination works where it is used.** Page 1,000 of assets costs about the
  same as page 1, which is the result worth having from this table.
- **The control is flat.** `/auth/me` at 13 ms confirms the numbers above are
  the endpoints and not the machine.

Nothing in that table has been optimised. That is the point of it.

## After S2 — bounded reads

Same tenant, same machine, `--compare baseline`. Committed at
`perf/baselines/after-s2.json`.

| Endpoint | p95 before | p95 after | Response before | after | |
|---|---|---|---|---|---|
| `GET /stock/levels` | 348 ms | **84 ms** | 589 KB | **8 KB** | paginated |
| `GET /stock/items` | 128 ms | **39 ms** | 280 KB | **71 KB** | capped + searchable |
| `GET /stock/batches` | 19 ms | 15 ms | 0 KB | 0 KB | capped |
| `GET /stock/locations` | 19 ms | 17 ms | 6 KB | 6 KB | capped |

Breaches: **3 of 14 → 2 of 14.**

### Reading the other deltas honestly

The probe also reported `/stock/movements` +64% and `/dashboard` +48%. **Neither
was touched by S2.** With 60 requests at concurrency 6 on a dev laptop, that is
run-to-run variance, and quoting it as a regression would be as wrong as quoting
it as an improvement. The control (`/auth/me`, -2%) is the check that the
machine itself did not move.

The two numbers that *are* signal are -76% and -69%, on the two endpoints whose
code changed, with response sizes falling by 98% and 75% alongside them. A
latency change that large with a matching payload change is not noise.

## After S3 — the nightly sweeps

Read paths had a probe; the background jobs had nothing, which is how the stock
sweep came to reload every movement ever recorded once per stock level without
anyone noticing. `pnpm --filter @techpioasset/api perf:sweep` now times them.

**A rig correction came first.** The generator was pairing items and locations
from two moduli of the same counter, which correlate — so one million movements
landed on just **2,000** distinct item/location pairs, at 500 movements each.
Real estates are the other way round: many pairs, few movements each, and the
sweep's cost scales with the number of *pairs*. Fixed, and the level count went
from 2,000 to **100,000** — which is what made the real cost visible.

| | 100,001 levels, 1M movements |
|---|---|
| Stock sweep **before** | **45.30 s** — one query per level, so ~100,000 round trips |
| Stock sweep **after** | **11.07 s** — one grouped query per 5,000-level batch |
| Nightly total | 45.32 s → **11.09 s**, against a 300 s budget |

The 4x is the local-database figure. The change that matters more is the shape:
100,000 round trips became about 40, and every one of those 100,000 carried
network latency in production that a laptop never charged for.

The arithmetic is unchanged — the SQL `CASE` is generated from the same sign map
the JavaScript used, so the two cannot drift apart, and the sweep's own tests
pass untouched.

## After S4 — plans and indexes from evidence

`EXPLAIN (ANALYZE, BUFFERS)` first, then only the changes the plans justified.

| Endpoint | baseline p95 | after S4 | |
|---|---|---|---|
| `GET /analytics/spend` | 2798 ms | **154 ms** | −94% |
| `GET /audit` | 1999 ms | **440 ms** | −78%, still over 300 ms |

Breaches: **3 of 14 → 1 of 14.**

**`/audit` — one missing index.** Every existing index led with `companyId` and
then a *second equality column*, so none could serve "this tenant, newest
first". The plan was a parallel sequential scan of 2M rows feeding a top-N
heapsort. With `(companyId, createdAt)`:

```
before:  Limit -> Sort (top-N heapsort) -> Parallel Seq Scan   263 ms
after:   Limit -> Index Scan Backward using the new index      0.106 ms
```

**`/analytics/spend` — not an index problem at all.** The query took 36 ms and
returned 100,000 rows; the endpoint took 2798 ms. The cost was never the query,
it was shipping 100,000 rows into Node to add them up. The months are now summed
by the database. `to_char(col, 'YYYY-MM')` matches `monthKey`'s
`toISOString().slice(0, 7)` — both UTC, on `timestamp without time zone` columns
holding UTC — and `analytics-spend-math.integration.test.ts` pins the arithmetic
either side of the move, including both month boundaries, a soft-deleted row and
a row outside the window.

### Why `/audit` still misses its target, honestly

The page query is now effectively free (0.1 ms). What is left is the **exact
total count** for offset pagination: a parallel index-only scan over two million
index entries, 78 ms alone and more under concurrency.

That is not an index problem — it is what an exact `count(*)` costs. Fixing it
means choosing: an approximate count (fast, and a number shown to users that is
no longer true), cursor pagination (exact, but a contract change), or a
short-lived cached count (exact-when-fresh, seconds stale). Each is a real
trade-off and none belongs in a workstream whose remit is "add the indexes the
plans justify".

It is recorded as input to **S6**, where audit-log growth is the subject and
partitioning would change this same number. They are not response-size problems: they are
a 2-million-row query plan (S4) and an aggregate computed in JavaScript over
every matching row (S4). Capping either would have made the answer wrong rather
than the response smaller.

## After S5 — exports that stream

A 100,000-row CSV export used to hold four copies of every row at once: the
Prisma objects, the mapped rows, the formatted lines, and the single joined
string. The reports are now defined **once** (`streamSpec`) and written a page
at a time, so both the JSON path and the export share one query, one column list
and one row mapper.

| Rows | Streamed CSV, peak **retained** | Buffered JSON, peak **retained** |
|---|---|---|
| 25,000 | 1.3 MB | 4.5 MB |
| 100,000 | **1.4 MB** | **16.4 MB** |

Four times the rows costs the streamed path **0.1 MB**. The buffered path grows
with the data, which is the definition this workstream was aimed at. 1.4 MB is
one page of 5,000 rows — exactly the bound in the code.

### Getting the measurement wrong twice first

Both mistakes are in the code as comments, because both are easy to repeat.

**Streaming that used more memory than buffering.** The first version called
`res.write()` once per row and ignored the return value. `false` means Node has
buffered the chunk because the socket is not draining — so 100,000 tiny writes
queued in memory faster than the socket emptied them. Measured *worse* than the
buffered version it replaced. Now: one write per page, and each awaits `drain`.

**A metric that measured the garbage collector.** Peak `heapUsed` without a
forced collection reports what was *allocated* before the collector happened to
run. Two identical runs of the same export reported **86 MB** and **108 MB** —
a number that moves 25% between identical runs cannot support a conclusion. The
lane now runs with `--expose-gc` and collects before each sample, so the figure
is what is still **held**. That is the difference between 108 MB and 1.4 MB for
the same export: the first was mostly garbage.

The comparison is an A/B in one run on identical data — CSV against
`format=JSON`, which still assembles every row — so the two numbers are produced
by the same process, the same rows and the same metric.

## After S6 — the audit total, and what the log costs

`/audit`'s page query was already free after S4 (0.1 ms). What remained was the
exact `count(*)` offset pagination needs: a parallel index-only scan over two
million index entries, 78 ms alone and more under concurrency.

The total is now cached for **15 seconds**; the page never is. The audit log is
append-only, so a stale total can only ever *undercount* by the last few
seconds' events, and the rows on the page are always exact. That trade is opt-in
per call site — `paginate()` takes the cache, it does not assume it.

| Endpoint | baseline p95 | after S6 |
|---|---|---|
| `GET /audit` | 1999 ms | **152 ms** (−92%) |

**0 of 14 endpoints miss their target.**

### What two million audit rows cost

| | rows | heap | indexes | total | per row |
|---|---|---|---|---|---|
| As first measured | 2,043,684 | 552 MB | 743 MB | 1294 MB | 664 B |
| **After `REINDEX`** | 2,043,684 | 552 MB | **237 MB** | **789 MB** | **405 B** |

The first reading was **64% bloat from this rig**, which had deleted and
reinserted two million rows six times over. Production only appends, so it does
not bloat this way. Publishing 664 B/row would have been a fact about the test
harness dressed up as a fact about the product.

At 10,000 audit events a day, a tenant accrues about **1.4 GB a year**.

## Final: the whole release, one table

| Endpoint | Baseline | Final | |
|---|---|---|---|
| `GET /audit` | 1999 ms | 152 ms | −92% |
| `GET /analytics/spend` | 2798 ms | 128 ms | −95% |
| `GET /stock/levels` | 348 ms / 589 KB | 167 ms / 7 KB | −52% / −99% |
| `GET /stock/items` | 128 ms | 33 ms | −74% |
| Nightly stock sweep | 45.30 s | 11.07 s | ~100,000 queries → ~40 |
| 100k-row export, retained heap | 16.4 MB | 1.4 MB | streamed |

Endpoints over target: **3 of 14 → 0 of 14**.

Every one of these is measured on one dev laptop against the same generated
tenant. The *shapes* travel; the absolute milliseconds are this machine's.
