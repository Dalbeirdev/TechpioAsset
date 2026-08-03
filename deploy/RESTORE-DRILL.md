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

## Off-site copies (v2.8 S1)

`backup-db.sh` ships a verified copy to S3-compatible storage when the destination is
configured. Set these in `.env.prod` (any S3-compatible provider works - AWS, Backblaze
B2, Wasabi, Cloudflare R2, MinIO):

```bash
BACKUP_S3_BUCKET=techpio-backups
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
BACKUP_S3_REGION=us-east-1          # optional, defaults to us-east-1
BACKUP_S3_ENDPOINT=https://...      # optional, for non-AWS providers
BACKUP_S3_PREFIX=techpioasset       # optional key prefix
```

Behaviour:

- The upload runs **inside the api container**, so the host needs no cloud tooling.
- It is **verified**, not assumed: after the PUT the object's size is read back from the
  destination and compared. A truncating proxy or a quota that silently drops the body
  fails the check rather than leaving you believing you have a backup.
- Off-site retention mirrors `KEEP_DAYS`, and only objects under this deployment's prefix
  are ever deleted.
- **A failed upload never destroys a good local backup.** The step exits non-fatally after
  logging `OFF-SITE UPLOAD FAILED`; the local dump stays exactly where it is.
- With no destination configured the log says `off-site SKIPPED (no destination configured
  - the local copy is the only copy)`, so the weaker posture is stated rather than implied.

**Not yet verified against a real cloud account** - no credentials exist in this
environment. The upload path is exercised end-to-end against an S3-compatible endpoint in
the test suite (`src/backup/backup-storage.test.ts`, including the truncated-object case),
which proves the protocol conversation but not a given vendor's quirks.

## Still open (honest)
- **PITR / WAL archiving.** Recovery granularity is one night, not one minute.
## Scheduled drill (v2.8 S2)

The drill runs itself on the 1st of each month at 04:30 and **shouts when it fails**:

```bash
( crontab -l 2>/dev/null; echo '30 4 1 * * /opt/techpioasset/deploy/restore-db.sh >> /var/log/techpioasset-drill.log 2>&1' ) | crontab -
```

- Every outcome is appended to `/var/log/techpioasset-drill.log`.
- A **failure** emails `OPS_ALERT_EMAIL` through the application's own MailProvider (real
  SMTP where configured, a readable `.eml` otherwise). Success is quiet by default -
  `DRILL_NOTIFY_ON_SUCCESS=1` opts in - because an alert channel that cries wolf is one
  people mute.
- Failure is detected at three points: no backup file exists at all, the dump does not
  restore, or the restored database is missing an expected table.

Verified by deliberately drilling a corrupted dump on the production host: the drill
exited non-zero, recorded `drill failed`, left the **live database untouched** and dropped
its scratch database.
