# Incident — API down ~5 minutes during the RLS role switch

**Date:** 2026-08-03, ~17:14–17:20 UTC
**Impact:** The production API crash-looped; piotask.com could not serve authenticated
or data-backed requests for roughly five minutes. No data was lost or corrupted; the
database was never modified by the failed change.
**Trigger:** Switching the API's `DATABASE_URL` to the newly created restricted role as
part of the v2.7 RLS enforcement rollout.

## What happened

1. The `techpioasset_app` role was created and — I believed — verified. My verification
   ran `psql` from inside the postgres container over `127.0.0.1`.
2. `.env.prod` was edited to point `DATABASE_URL` at that role, and the API container was
   restarted.
3. The API failed to authenticate (`P1000`) and entered a restart loop.
4. Rolled back by restoring `.env.prod` from the backup taken immediately before the edit,
   and restarting. Service returned; the site answered 200 and the API 401-guarded again.

## Why the verification lied

`pg_hba.conf` ships with:

```
host all all 127.0.0.1/32 trust
```

A `psql` connection from inside the postgres container matches that rule and is accepted
**without the password being checked at all**. So the test proved only that the role
existed. Over the real path the application uses (`host=postgres`, `scram-sha-256`) the
credential was wrong.

It was wrong because of a second defect: `deploy/rls-app-role.sql`'s own usage line said
to pass `-v app_password="'<password>'"` while the SQL uses psql's `:'app_password'`
form, which quotes the value itself. The role's password therefore literally contained
the single-quote characters. (A third defect, fixed first, had prevented the script from
running at all: psql does not interpolate `:'variables'` inside `DO $$ … $$` blocks.)

None of the three had ever been noticed because the script was written in v2.1 for a
rollout that stayed staged for six releases. **Code that has never been executed is not
known to work, however carefully it was reviewed.**

## What I did wrong

- Edited production configuration on the strength of a verification that could not fail —
  a `trust` rule made it a tautology.
- Changed a live serving credential without a health gate, so the failure mode was a
  crash loop rather than an aborted change.

## Fixes applied

| Fix | Where |
|---|---|
| `DO $$` interpolation bug in the role script | #122 |
| Usage line double-quoting the password | #123 |
| Verify credentials over the **real** auth path (`-h postgres`) *before* editing any config | rollout script |
| Switch script auto-rolls-back if `/health/ready` does not return 200 within 100s | rollout script |
| Nested-transaction path (licence assign) pinned in the RLS lane | #124 |
| All of the above folded into one reviewed tool, tested positive **and** negative | `deploy/preflight.sh` (v2.8 S3) |

The corrected sequence — rotate → verify over the real path → back up env → switch →
health-gate → auto-rollback — was then used for both the role switch and the enforcement
flip, and both succeeded on the first attempt.

## Lessons worth keeping

1. **A test that cannot fail is not a test.** Ask what result would have been produced had
   the thing been broken; if the answer is "the same one", the test is decoration.
2. **Verify credentials on the path the application actually uses**, not a convenient one.
3. **Gate risky config changes on health, with automatic rollback** — the difference
   between five minutes of downtime and none is whether the script checks its own work.
4. Long-staged scripts deserve a rehearsal before the day they matter — the same argument
   that produced the restore drill (`deploy/RESTORE-DRILL.md`) in this release.

## Current state

RLS enforcement is live and verified at every layer: the API connects as
`techpioasset_app`, that role is `NOSUPERUSER` / `NOBYPASSRLS`, and all 43 tenant tables
carry FORCE row-level security with the corrected `NULLIF` policies. Rollback remains one
command (`deploy/RLS-ROLLOUT.md`).
