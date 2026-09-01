#!/usr/bin/env bash
#
# Daily backup for the TechpioAsset production stack: the database AND the
# files people have uploaded.
#
# Dumps the postgres container's database to a timestamped, gzipped file,
# archives the uploads volume alongside it (v2.33), prunes both older than
# KEEP_DAYS, and (v2.8) ships verified copies off the box to S3-compatible
# storage when BACKUP_S3_* is configured. Backups live OUTSIDE the git working
# tree (/var/backups/techpioasset) so a `git pull`/redeploy never touches them.
#
# The two halves are useless apart. An `attachments` row points at a storage
# key; restoring the database without the files leaves every condition photo
# and receipt as a broken reference, and restoring the files without the
# database leaves bytes nobody can find. Restore them as a pair, from the
# same timestamp.
#
# Install (on the VPS):
#   chmod +x /opt/techpioasset/deploy/backup-db.sh
#   ( crontab -l 2>/dev/null; echo '30 3 * * * /opt/techpioasset/deploy/backup-db.sh >> /var/log/techpioasset-backup.log 2>&1' ) | crontab -
#
# Restore a dump into the running stack:
#   gunzip -c /var/backups/techpioasset/techpioasset_YYYY-MM-DD_HHMMSS.sql.gz \
#     | docker compose -f /opt/techpioasset/docker-compose.vps.yml --env-file /opt/techpioasset/.env.prod \
#         exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
#
# Restore the uploaded files from the SAME timestamp (stop the api first, so
# nothing is writing into the directory while it is replaced):
#   cd /opt/techpioasset
#   docker compose -f docker-compose.vps.yml --env-file .env.prod stop api
#   DIR=$(docker inspect "$(docker compose -f docker-compose.vps.yml --env-file .env.prod ps -aq api)" \
#     --format '{{range .Mounts}}{{if eq .Destination "/app/apps/api/.local-storage"}}{{.Source}}{{end}}{{end}}')
#   tar -xzf /var/backups/techpioasset/techpioasset-uploads_YYYY-MM-DD_HHMMSS.tar.gz -C "$DIR"
#   docker compose -f docker-compose.vps.yml --env-file .env.prod start api
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

# ── v2.33: the uploaded files ────────────────────────────────────────────────
# The dump above is the database only. Everything people upload - request
# attachments, and from v2.32 the condition photos taken at handover and at
# return - lives in a Docker volume that pg_dump knows nothing about. Those
# photos exist to be produced later as evidence, and a row in `attachments`
# pointing at bytes that no longer exist is worse than no row at all.
#
# Failures here are loud but never destroy the dump: the database backup is
# already written, verified and rotated by this point. The script still exits
# non-zero so a failed photo backup shows up in cron mail instead of passing
# quietly for months.
UPLOADS_STATUS=0

# Resolved from the api container's own mounts rather than a hardcoded volume
# name or host path, so renaming the compose project - or moving the volume to
# a different driver - does not silently start backing up nothing.
API_CID="$(docker compose -f "$APP_DIR/docker-compose.vps.yml" --env-file "$APP_DIR/.env.prod" ps -q api 2>/dev/null || true)"
UPLOADS_DIR=""
if [ -n "$API_CID" ]; then
  UPLOADS_DIR="$(docker inspect "$API_CID" \
    --format '{{range .Mounts}}{{if eq .Destination "/app/apps/api/.local-storage"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
fi

if [ -z "$UPLOADS_DIR" ] || [ ! -d "$UPLOADS_DIR" ]; then
  echo "$(date -Is) UPLOADS BACKUP FAILED: could not resolve the uploads volume from the api container" >&2
  UPLOADS_STATUS=1
else
  UPLOADS_OUT="$BACKUP_DIR/techpioasset-uploads_${TS}.tar.gz"

  # tar exits 1 when a file changed while being read - entirely possible, since
  # the API keeps serving during the backup. The archive is still valid, so 1 is
  # tolerated and only 2+ is treated as a real failure.
  set +e
  tar --warning=no-file-changed -czf "$UPLOADS_OUT" -C "$UPLOADS_DIR" . 2>/dev/null
  TAR_RC=$?
  set -e

  if [ "$TAR_RC" -gt 1 ]; then
    echo "$(date -Is) UPLOADS BACKUP FAILED (tar exit $TAR_RC): $UPLOADS_OUT" >&2
    rm -f "$UPLOADS_OUT"
    UPLOADS_STATUS=1
  elif ! gzip -t "$UPLOADS_OUT" 2>/dev/null || [ ! -s "$UPLOADS_OUT" ]; then
    echo "$(date -Is) UPLOADS BACKUP FAILED (empty or corrupt): $UPLOADS_OUT" >&2
    rm -f "$UPLOADS_OUT"
    UPLOADS_STATUS=1
  else
    find "$BACKUP_DIR" -name 'techpioasset-uploads_*.tar.gz' -type f -mtime "+${KEEP_DAYS}" -delete
    echo "$(date -Is) uploads ok: $UPLOADS_OUT ($(du -h "$UPLOADS_OUT" | cut -f1), $(tar -tzf "$UPLOADS_OUT" | grep -cv '/$') files); retained: $(ls -1 "$BACKUP_DIR"/techpioasset-uploads_*.tar.gz 2>/dev/null | wc -l)"

    # Same off-site route as the dump, and non-fatal for the same reason.
    UPLOADS_JSON="$(docker compose -f "$APP_DIR/docker-compose.vps.yml" --env-file "$APP_DIR/.env.prod" \
      exec -T api node dist/backup/upload-cli.js "$(basename "$UPLOADS_OUT")" "$KEEP_DAYS" < "$UPLOADS_OUT" 2>&1 | tail -1)" || true

    case "$UPLOADS_JSON" in
      *'"status":"uploaded"'*)
        echo "$(date -Is) uploads off-site ok: $UPLOADS_JSON" ;;
      *'"status":"skipped"'*)
        echo "$(date -Is) uploads off-site SKIPPED (no destination configured - the local copy is the only copy)" ;;
      *)
        echo "$(date -Is) UPLOADS OFF-SITE UPLOAD FAILED: $UPLOADS_JSON" >&2 ;;
    esac
  fi
fi

exit "$UPLOADS_STATUS"
