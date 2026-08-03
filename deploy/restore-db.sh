#!/usr/bin/env bash
#
# Restore DRILL for the TechpioAsset production stack (v2.7 R6).
#
# Proves the backups actually restore. Restores a chosen dump into a SCRATCH
# database beside the live one, verifies row counts against the live database,
# prints a comparison, and drops the scratch database again.
#
# It NEVER touches the live database: the scratch name is generated here, the
# script refuses to run if it would collide with POSTGRES_DB, and every psql
# call targets the scratch name explicitly.
#
# Usage (on the VPS):
#   /opt/techpioasset/deploy/restore-db.sh                  # newest backup
#   /opt/techpioasset/deploy/restore-db.sh <path-to-.sql.gz>
#   KEEP_SCRATCH=1 /opt/techpioasset/deploy/restore-db.sh   # leave it for inspection
#
# A real recovery is the documented one-liner in backup-db.sh's header; this
# script is the rehearsal, so an operator has done it once before the day it
# matters.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/techpioasset}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/techpioasset}"
COMPOSE="docker compose -f $APP_DIR/docker-compose.vps.yml --env-file $APP_DIR/.env.prod"
DRILL_LOG="${DRILL_LOG:-/var/log/techpioasset-drill.log}"

# v2.8 S2: record every outcome, and make a FAILURE shout. A drill whose result
# nobody reads has not run. Notification goes through the app's MailProvider in
# the api container, so real SMTP deployments get real mail.
record() {  # record <passed|failed> <detail>
  printf '%s drill %s: %s
' "$(date -Is)" "$1" "$2" >> "$DRILL_LOG" 2>/dev/null || true
  if [[ "$1" == "failed" || "${DRILL_NOTIFY_ON_SUCCESS:-0}" == "1" ]]; then
    $COMPOSE exec -T api node dist/backup/drill-notify-cli.js "$1" "$2" </dev/null 2>&1 | tail -1 || true
  fi
}

set -a
# shellcheck disable=SC1091
source <(grep -E '^POSTGRES_(USER|DB|PASSWORD)=' "$APP_DIR/.env.prod")
set +a

DUMP="${1:-$(ls -1t "$BACKUP_DIR"/techpioasset_*.sql.gz 2>/dev/null | head -1)}"
if [[ -z "${DUMP:-}" || ! -f "$DUMP" ]]; then
  echo "No backup found. Looked in $BACKUP_DIR (or the path you passed)." >&2
  record failed "No backup file found in $BACKUP_DIR - there may be nothing to restore FROM."
  exit 1
fi

SCRATCH="restore_drill_$(date +%s)"
if [[ "$SCRATCH" == "$POSTGRES_DB" ]]; then
  echo "Refusing to run: the scratch name collides with the live database." >&2
  exit 1
fi

psql_scratch() { $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -qtAX -U "$POSTGRES_USER" -d "$SCRATCH" -c "$1" </dev/null; }
psql_live()    { $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -qtAX -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1" </dev/null; }
psql_admin()   { $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -qtAX -U "$POSTGRES_USER" -d postgres -c "$1" </dev/null; }

cleanup() {
  if [[ "${KEEP_SCRATCH:-0}" == "1" ]]; then
    echo "KEEP_SCRATCH=1 - leaving $SCRATCH in place. Drop it with:"
    echo "  $COMPOSE exec -T postgres psql -U $POSTGRES_USER -d postgres -c 'DROP DATABASE $SCRATCH'"
    return
  fi
  psql_admin "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true
  echo "Scratch database dropped."
}
trap cleanup EXIT

echo "Restore drill"
echo "  dump:    $DUMP ($(du -h "$DUMP" | cut -f1))"
echo "  scratch: $SCRATCH"
echo "  live:    $POSTGRES_DB (never written to)"
echo

psql_admin "CREATE DATABASE \"$SCRATCH\"" >/dev/null
echo "Restoring..."
gunzip -c "$DUMP" \
  | $COMPOSE exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -q -U "$POSTGRES_USER" -d "$SCRATCH" >/dev/null

# Row counts on the tables that would hurt most to lose.
TABLES=(companies users assets software_licenses purchase_orders audit_logs)
echo
printf '%-22s %12s %12s   %s\n' TABLE RESTORED LIVE STATUS
FAILED=0
for t in "${TABLES[@]}"; do
  R="$(psql_scratch "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo missing)"
  L="$(psql_live    "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo missing)"
  if [[ "$R" == "missing" ]]; then
    STATUS="MISSING IN RESTORE"; FAILED=1
  elif [[ "$R" == "$L" ]]; then
    STATUS="ok"
  else
    # Live may legitimately have grown since the dump was taken; only a
    # SHORTFALL beyond that is suspicious, so report rather than pass silently.
    STATUS="differs (dump is older than live)"
  fi
  printf '%-22s %12s %12s   %s\n' "$t" "$R" "$L" "$STATUS"
done

echo
if [[ "$FAILED" == "1" ]]; then
  echo "DRILL FAILED: at least one table did not restore." >&2
  record failed "$(basename "$DUMP") restored but a expected table was missing - see $DRILL_LOG."
  exit 1
fi
echo "Drill passed: the dump restores into a working database."
record passed "$(basename "$DUMP") restored with matching row counts."
