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

The remaining two breaches — `/audit` at 1992 ms and `/analytics/spend` at
2952 ms — are unchanged by design. They are not response-size problems: they are
a 2-million-row query plan (S4) and an aggregate computed in JavaScript over
every matching row (S4). Capping either would have made the answer wrong rather
than the response smaller.
