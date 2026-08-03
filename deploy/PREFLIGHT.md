# Deploy preflight

`deploy/preflight.sh` answers one question before a production change: **has anything
that would make this deploy dangerous already gone wrong?**

It exists because of the [2026-08-03 incident](../docs/incident-2026-08-03-rls-switch.md),
where a credential was "verified" over a path that could not fail and a bad value became a
crash loop instead of an aborted change.

## The rule

> **A check that cannot prove its claim fails the deploy.**

There is no "probably fine" branch. If a check cannot demonstrate the thing it asserts, it
reports FAIL and the script exits non-zero.

## Running it

```bash
/opt/techpioasset/deploy/preflight.sh            # summary
/opt/techpioasset/deploy/preflight.sh --verbose  # show each check's evidence
```

Exit 0 = every check proved its claim. Anything else = do not deploy until you know why.

## What it checks

| # | Check | Why it earns its place |
|---|---|---|
| 1 | The serving credential authenticates **over the path the application uses** (`host=postgres`, scram-sha-256) | The incident, in one check. `pg_hba` ships `127.0.0.1/32 trust`, so a psql test inside the postgres container succeeds *without checking the password* |
| 2 | Migrations still have an owner-capable connection | Catches "restricted `DATABASE_URL` + missing `MIGRATE_DATABASE_URL`", which breaks migrate-on-start at the **next** deploy, not this one |
| 3 | RLS posture is coherent | `RLS_ENFORCE=true` with a serving role that can bypass RLS is enforcement theatre; the check says so |
| 4 | A backup exists and is ≤26h old | Deploying without a recent dump turns a recoverable mistake into an unrecoverable one |
| 5 | Off-site destination configured | Reports the weaker posture honestly rather than staying silent (note, not a failure) |
| 6 | The API is healthy **before** the change | So a pre-existing failure is not misattributed to your deploy |

## Verified both ways

Run against production on 2026-08-03:

- **Positive** — all checks passed against the real state (serving as `techpioasset_app`,
  owner migrations, RLS genuinely enforcing, a 0h-old backup, healthy API).
- **Negative** — re-run against a throwaway copy of the config carrying the incident's
  exact fault (a wrong serving password): check 1 reported
  `THIS IS THE INCIDENT. Do not restart the api container.` and the script exited 1.
  Production configuration was never touched.

A preflight that has only ever passed is indistinguishable from one that cannot fail —
which is the failure mode it was written to prevent, so it is tested both ways.
