# Backup restore drill (v2.7 R6)

Backups that have never been restored are a hope, not a plan. This is the
rehearsal, so the first time anyone restores this database is not the day it
matters.

## What exists

- **Backups**: `deploy/backup-db.sh` runs nightly at 03:30 by root cron →
  gzipped `pg_dump` into `/var/backups/techpioasset/`, 14-day rotation,
  integrity-checked on write. Backups live outside the git tree, so a
  `git pull` or redeploy never touches them.
- **Drill**: `deploy/restore-db.sh` restores a chosen dump (newest by default)
  into a **scratch database beside the live one**, compares row counts against
  live, prints a table, and drops the scratch database on exit.

## Safety

The drill never writes to the live database:

- the scratch name is generated per-run (`restore_drill_<epoch>`);
- the script refuses to run if that name could collide with `POSTGRES_DB`;
- every `psql` call names its target database explicitly;
- an `EXIT` trap drops the scratch database even on failure
  (`KEEP_SCRATCH=1` keeps it for inspection and prints the drop command).

## Running it

```bash
/opt/techpioasset/deploy/restore-db.sh                  # newest backup
/opt/techpioasset/deploy/restore-db.sh /var/backups/techpioasset/techpioasset_2026-08-03_152610.sql.gz
```

## Drill record — 2026-08-03 (v2.7)

First rehearsal, against the real production backup taken during the v2.6
deploy (`techpioasset_2026-08-03_152610.sql.gz`, 76K):

| Table | Restored | Live | Status |
|---|---|---|---|
| companies | 1 | 1 | ok |
| users | 11 | 11 | ok |
| assets | 15 | 15 | ok |
| software_licenses | 0 | 0 | ok |
| purchase_orders | 0 | 0 | ok |
| audit_logs | 106 | 106 | ok |

**Result: passed.** The dump restores into a working database with matching
row counts; the scratch database was dropped automatically.

Note on interpretation: a *difference* is not automatically a failure — live
legitimately grows after a dump is taken, so the script reports "differs (dump
is older than live)" rather than passing or failing silently. Only a table
that fails to restore at all fails the drill.

## Real recovery (not a drill)

Restoring over the live database is the documented one-liner in
`backup-db.sh`'s header. Stop the api container first so nothing writes during
the restore, then restart it:

```bash
cd /opt/techpioasset
docker compose -f docker-compose.vps.yml --env-file .env.prod stop api
gunzip -c /var/backups/techpioasset/<dump>.sql.gz \
  | docker compose -f docker-compose.vps.yml --env-file .env.prod \
      exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose -f docker-compose.vps.yml --env-file .env.prod start api
```

## Still open (honest)

- **Off-site copies.** Backups live only on the VPS; a host loss loses them.
- **PITR / WAL archiving.** Recovery granularity is one night, not one minute.
- **Automated drill.** This one was operator-run; scheduling it monthly (and
  alerting on failure) is the obvious next step.
