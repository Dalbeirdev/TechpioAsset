# v2.10 QA scorecard — Scale

**Verdict: PASS.** Every acceptance criterion is met, and the release's governing
rule was applied to itself throughout: **a performance claim comes with a number
and the volume it was measured at, or it is not made.**

Suite at close: **86 unit + 412 integration + 7 RLS-lane + 2 throttle-lane = 507
API tests**, plus 313 domain / 14 contracts / 61 ui-tokens / 8 web / 25 mobile.
All green with the load tenant present. `tsc`, `eslint` and `next build` clean.

## The headline

At **100k assets · 1M stock movements · 2M audit rows · 100k stock levels**:

| Endpoint | Before | After | |
|---|---|---|---|
| `GET /audit` | 1999 ms | **152 ms** | −92% |
| `GET /analytics/spend` | 2798 ms | **128 ms** | −95% |
| `GET /stock/levels` | 348 ms (589 KB) | **167 ms (7 KB)** | −52%, −99% payload |
| `GET /stock/items` | 128 ms | **33 ms** | −74% |

**Endpoints missing their target: 3 of 14 → 0 of 14.**

| Job / operation | Before | After |
|---|---|---|
| Nightly stock sweep | 45.30 s (~100,000 queries) | **11.07 s** (~40 queries) |
| 100k-row CSV export, peak **retained** heap | 16.4 MB (buffered) | **1.4 MB** (streamed) |

## Acceptance criteria, and how each was actually proven

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | One command builds the large tenant, repeatably, with baselines taken **before** any fix | **PASS** | `perf:generate` builds 100k assets / 1M movements / 2M audit rows in ~140 s, generated *inside* Postgres and deterministic. `perf/baselines/baseline.json` was committed before a line of production code changed |
| 2 | Every list endpoint p95 < 300 ms and never more than one page | **PASS** | 0 of 14 over target. `/stock/levels` paginated; pickers capped and searchable; **a guard test fails the build** when a new unbounded query lands on a tenant-scaled table |
| 3 | The nightly sweep finishes under 5 minutes; the drift check is one query, not one per level | **PASS** | 11.07 s against a 300 s budget. The per-level N+1 became one grouped query per 5,000-level batch, with the SQL `CASE` **generated from the same sign map** the JavaScript used |
| 4 | A 100k-row export runs with a measured memory high-water mark | **PASS** | 1.4 MB retained streamed vs 16.4 MB buffered, A/B in one run on identical data. 4× the rows costs the streamed path 0.1 MB |
| 5 | Audit growth has a measured cost and an implemented answer; append-only and undeletable still hold | **PASS (scoped)** | 405 bytes/row measured; the count that dominated `/audit` is now cached for 15 s while the page stays exact. Partitioning is **recommended and not implemented** — see below |
| 6 | Zero regression; every optimisation lands with its before/after number | **PASS** | All four lanes green throughout. Every workstream's PR carries its measured delta, and `perf/README.md` carries the whole progression |

## What 2 million audit rows actually cost

Measured after `REINDEX`, because the first reading was wrong:

| | rows | heap | indexes | total | per row |
|---|---|---|---|---|---|
| As measured | 2,043,684 | 552 MB | 743 MB | 1294 MB | 664 B |
| **After reindex** | 2,043,684 | 552 MB | **237 MB** | **789 MB** | **405 B** |

**The first number was 64% bloat from the rig itself**, which had deleted and
reinserted two million rows six times over. Production only ever appends, so it
does not bloat this way — reporting 664 B/row would have been a fiction about
somebody else's database. The honest figure is **405 bytes per audit row**, of
which 30% is indexes.

At 10,000 audit events a day, a tenant accrues roughly **1.4 GB a year**.

### Why partitioning is recommended but not implemented

The measured problem was never the table size — it was the exact `count(*)` for
offset pagination, and that is fixed. Converting a live, append-only,
two-million-row table to a partitioned one means building a new table, copying
every row and swapping, on data whose entire value is that it has never been
tampered with.

That deserves its own release with its own rollback plan, not the last afternoon
of this one. The numbers to justify it now exist, which is what this workstream
owed.

## Design decisions worth recording

- **The rig lied three times before it was trustworthy**, and each would have
  produced a confident, false baseline: a password hash copied from a previous
  run of itself (with a silent placeholder fallback that still printed "measure
  as load1@…"), a role key that resolved to `OWN` scope so the rig user saw
  **zero of its 100,000 assets**, and fabricated stock drift that failed a real
  test. All are fixed and commented where they happened.
- **Then the rig understated the thing under test.** Items and locations were
  paired from two moduli of the same counter, which correlate, so a million
  movements landed on 2,000 pairs instead of 100,000. Correcting it moved the
  *unchanged* sweep from 5.5 s to 45 s. **That 45 s was always true and had
  simply never been measured** — optimising against the old rig would have
  reported a tidy win on a number that understated the problem 50×.
- **The probe reported the API's own rate limiter as endpoint errors.** It now
  aborts on 401/403/429 with the remedy and refuses to write a baseline from a
  contaminated run.
- **My first "streaming" export used more memory than buffering.** `res.write()`
  per row with the return value ignored queues chunks faster than a socket
  drains. One write per page, each awaiting `drain`.
- **And the memory metric was measuring the garbage collector.** Peak `heapUsed`
  without a forced collection reports what was *allocated*: two identical runs
  gave 86 MB and 108 MB. Forcing GC before each sample is the whole distance
  between "108 MB" and "1.4 MB" for the same export.
- **Correctness was pinned before arithmetic moved.** The spend test was written
  and passing against the old JavaScript path *first*, asserting totals to the
  cent across both month boundaries, a soft-deleted row and a row outside the
  window — then had to keep passing once the sum moved into SQL.
- **An index was added only where a plan asked for one.** `/analytics/spend`
  needed none: its query was 36 ms returning 100,000 rows while the endpoint took
  2.8 s. Starting from "add indexes" would have added one there and achieved
  nothing.

## Open, honestly

| Gap | Status |
|---|---|
| **Audit-log partitioning** | Recommended, not implemented. The cost is measured (405 B/row, ~1.4 GB/year at 10k events/day); the migration deserves its own release |
| **Every number is from one dev laptop** | Single machine, local Postgres, no network latency. The *shapes* (100,000 round trips → 40; 16.4 MB retained → 1.4 MB) travel; the absolute milliseconds do not |
| **Production has not been measured** | It holds 15 assets. These figures describe what a large tenant *would* meet, not what today's users experience |
| **Two picker endpoints are capped at 500** | Past that the UI is the constraint, not the query. A tenant that large needs the picker to become a search box |
| **`/stock/locations` +52%, `/auth/me` +17%** | Untouched code; run-to-run variance on 60 requests at concurrency 6. Reported rather than hidden, and not claimed as either result |
| Off-site backups | **Still needs `BACKUP_S3_*`.** Unchanged since v2.8 and still the largest operational risk in the system |
| Tracing | Opt-in, no collector configured — the tool that would make these measurements continuous rather than one-off |
| PITR/WAL, DR region, hash-chained audit, vendor portal, multi-currency | Blueprint-future, unchanged |

## Deploy notes

- **No new permission keys — no seed re-run.**
- **No mobile changes — no APK rebuild.**
- **One migration:** `20260805090000_audit_company_created_index`, additive. It
  builds an index on `audit_logs`; production holds 107 audit rows, so it is
  effectively instantaneous there.
- **No new environment variables.**
- Run `deploy/preflight.sh` first.
- **Behaviour change to note:** `GET /stock/levels` is now paginated (an
  enveloped `{data, meta}` rather than a bare array). Web and mobile were updated
  in the same release; any external caller of that endpoint must be too.
