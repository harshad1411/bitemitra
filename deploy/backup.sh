#!/usr/bin/env bash
# Daily extra copy of the database (D-103, D-118), run by the jamzo-backup timer. The managed database already
# keeps daily backups and 7-day point-in-time restore; this copy lives in the Spaces bucket under backups/
# (private), kept 30 days by a lifecycle rule. Checks the dump can be read before uploading; emails on failure.
set -uo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
DIR=/var/backups/jamzo
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="jamzo-$STAMP.dump"
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

fail() {
  echo "✗ backup failed: $1" >&2
  ./send-alert.sh "Jamzo: database backup FAILED" "The daily extra database backup failed on $(hostname) at $(date -u '+%Y-%m-%d %H:%M UTC'): $1
DigitalOcean's own daily backups are not affected. Check: journalctl -u jamzo-backup" || true
  exit 1
}

# pg_dump 18 from the official image; the database CA is mounted where DATABASE_URL expects it (/certs).
docker run --rm --env-file <(grep -E '^DATABASE_URL=' "$ENV_FILE") -v "$PWD/certs:/certs:ro" -v "$DIR:/out" postgres:18 \
  sh -c "pg_dump --format=custom --compress=9 --no-owner --no-privileges --file /out/$FILE \"\$DATABASE_URL\"" ||
  fail "pg_dump did not finish"
docker run --rm -v "$DIR:/out:ro" postgres:18 pg_restore --list "/out/$FILE" >/dev/null || fail "the dump cannot be read"
SIZE="$(du -h "$DIR/$FILE" | cut -f1)"

ENDPOINT="$(get SPACES_ENDPOINT)"
BUCKET="$(get SPACES_BUCKET)"
REGION="$(printf '%s' "$ENDPOINT" | sed -E 's#https?://([a-z0-9]+)\..*#\1#')"
aws() {
  docker run --rm -e AWS_ACCESS_KEY_ID="$(get SPACES_KEY)" -e AWS_SECRET_ACCESS_KEY="$(get SPACES_SECRET)" \
    -e AWS_DEFAULT_REGION="$REGION" -v "$DIR:/out:ro" -v "$PWD/backup-lifecycle.json:/lifecycle.json:ro" \
    amazon/aws-cli:2.31.9 --endpoint-url "$ENDPOINT" "$@"
}
aws s3 cp "/out/$FILE" "s3://$BUCKET/backups/$FILE" --acl private --only-show-errors || fail "upload to Spaces failed"
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file:///lifecycle.json \
  >/dev/null || echo "! could not set the 30-day rule (the copy was still uploaded)" >&2

# Keep the two newest copies on the server too.
ls -1t "$DIR"/jamzo-*.dump 2>/dev/null | tail -n +3 | xargs -r rm -f
date -u +%s > "$DIR/last-success"
echo "✓ backup $FILE ($SIZE) uploaded to $BUCKET/backups/"
