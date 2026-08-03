#!/usr/bin/env bash
#
# Daily PostgreSQL backup for the TechpioAsset production stack.
#
# Dumps the postgres container's database to a timestamped, gzipped file,
# prunes dumps older than KEEP_DAYS, and (v2.8) ships a verified copy off the
# box to S3-compatible storage when BACKUP_S3_* is configured. Backups live OUTSIDE the git working tree
# (/var/backups/techpioasset) so a `git pull`/redeploy never touches them.
#
# Install (on the VPS):
#   chmod +x /opt/techpioasset/deploy/backup-db.sh
#   ( crontab -l 2>/dev/null; echo '30 3 * * * /opt/techpioasset/deploy/backup-db.sh >> /var/log/techpioasset-backup.log 2>&1' ) | crontab -
#
# Restore a dump into the running stack:
#   gunzip -c /var/backups/techpioasset/techpioasset_YYYY-MM-DD_HHMMSS.sql.gz \
#     | docker compose -f /opt/techpioasset/docker-compose.vps.yml --env-file /opt/techpioasset/.env.prod \
#         exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/techpioasset}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/techpioasset}"
KEEP_DAYS="${KEEP_DAYS:-14}"

# Load DB credentials from the production env file.
set -a
# shellcheck disable=SC1091
source <(grep -E '^POSTGRES_(USER|DB|PASSWORD)=' "$APP_DIR/.env.prod")
set +a

mkdir -p "$BACKUP_DIR"
TS="$(date +%F_%H%M%S)"
OUT="$BACKUP_DIR/techpioasset_${TS}.sql.gz"

docker compose -f "$APP_DIR/docker-compose.vps.yml" --env-file "$APP_DIR/.env.prod" \
  exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -9 > "$OUT"

# Fail loudly if the dump is empty/corrupt rather than silently keeping junk.
if ! gzip -t "$OUT" 2>/dev/null || [ ! -s "$OUT" ]; then
  echo "$(date -Is) BACKUP FAILED (empty or corrupt): $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

# Rotate: delete dumps older than KEEP_DAYS.
find "$BACKUP_DIR" -name 'techpioasset_*.sql.gz' -type f -mtime "+${KEEP_DAYS}" -delete

echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1)); retained: $(ls -1 "$BACKUP_DIR"/techpioasset_*.sql.gz 2>/dev/null | wc -l)"

# ── v2.8 S1: ship a copy off the box ─────────────────────────────────────────
# Until this existed, every backup lived on the same machine as the database it
# protects, so losing the host lost both. The upload runs INSIDE the api
# container (which already has node, the SDK and the production env), so the
# host needs no cloud tooling. It is deliberately non-fatal: a failed upload
# must never turn a good local backup into no backup - it exits 0 after
# shouting, and the local dump stays exactly where it is.
UPLOAD_JSON="$(gzip -dc "$OUT" | gzip -9   | docker compose -f "$APP_DIR/docker-compose.vps.yml" --env-file "$APP_DIR/.env.prod"       exec -T api node dist/backup/upload-cli.js "$(basename "$OUT")" "$KEEP_DAYS" 2>&1 | tail -1)" || true

case "$UPLOAD_JSON" in
  *'"status":"uploaded"'*)
    echo "$(date -Is) off-site ok: $UPLOAD_JSON" ;;
  *'"status":"skipped"'*)
    echo "$(date -Is) off-site SKIPPED (no destination configured - the local copy is the only copy)" ;;
  *)
    echo "$(date -Is) OFF-SITE UPLOAD FAILED: $UPLOAD_JSON" >&2 ;;
esac
