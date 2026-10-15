#!/usr/bin/env bash
# First-time setup on the Droplet (D-101), run by the owner so secrets never leave the server:
#   ssh -t root@<droplet-ip> /opt/jamzo/deploy/first-setup.sh
# 1) generates the server's own secrets, 2) asks for the database URL and the Spaces keys (typing is hidden),
# 3) writes deploy/.env.production (owner-only file, never committed), 4) creates the tables and the first
# Super Admin, 5) starts Jamzo behind Caddy (HTTPS).
#
# MODE=demo (default for now): APP_ENV=development — sign-in codes are written to the server log instead of
# being sent by SMS/email, online payments are off, and demo restaurants can be added. NOT for the public:
# switch to staging/production once MSG91, email and Razorpay are set up (docs/DEPLOYMENT.md).
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env.production
MODE="${MODE:-demo}"

if [ -f "$ENV_FILE" ] && [ "${FORCE:-}" != "1" ]; then
  echo "deploy/$ENV_FILE already exists — keeping it (run with FORCE=1 to write it again)."
else
  echo
  echo "== Jamzo first-time setup (mode: $MODE) =="
  echo "Paste values with Cmd+V and press Enter. Secret answers are not shown while you type."
  echo
  read -r -s -p "1/4 Database VPC connection string (starts with postgresql://, hidden): " DB_URL; echo
  case "$DB_URL" in postgresql://*|postgres://*) ;; *) echo "That does not look like a connection string."; exit 1 ;; esac
  case "$DB_URL" in *sslmode=*) ;; *\?*) DB_URL="$DB_URL&sslmode=require" ;; *) DB_URL="$DB_URL?sslmode=require" ;; esac
  read -r -p "2/4 Spaces bucket name [jamzo]: " BUCKET; BUCKET="${BUCKET:-jamzo}"
  read -r -p "3/4 Spaces Access Key: " SPACES_KEY
  read -r -s -p "4/4 Spaces Secret Key (hidden): " SPACES_SECRET; echo
  umask 077
  cat > "$ENV_FILE" <<ENV
# Written by deploy/first-setup.sh on $(date -u +%Y-%m-%dT%H:%MZ). Owner-only file; never commit or share it.
APP_ENV=$([ "$MODE" = demo ] && echo development || echo "$MODE")
LOG_LEVEL=info
DATABASE_URL=$DB_URL
JWT_ACCESS_SECRET=$(openssl rand -base64 48 | tr -d '\n')
OTP_PEPPER=$(openssl rand -base64 48 | tr -d '\n')
FIELD_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
METRICS_TOKEN=$(openssl rand -hex 24)
TRUST_PROXY=true
COOKIE_SECURE=true
CORS_ORIGINS=https://admin.jamzo.in
MEDIA_STORAGE_DRIVER=spaces
SPACES_ENDPOINT=https://sgp1.digitaloceanspaces.com
SPACES_BUCKET=$BUCKET
SPACES_KEY=$SPACES_KEY
SPACES_SECRET=$SPACES_SECRET
MEDIA_PUBLIC_BASE_URL=https://$BUCKET.sgp1.cdn.digitaloceanspaces.com
PAYMENT_PROVIDER=fake
SMS_PROVIDER=console
EMAIL_PROVIDER=console
PUSH_PROVIDER=console
ENV
  chmod 600 "$ENV_FILE"
  # DigitalOcean's connection string names a placeholder CA file; fetch the database's own CA (public) and use it,
  # so the connection is encrypted and verified (sslmode=verify-full).
  DB_HOST=$(echo "$DB_URL" | sed -E 's#^[a-z]+://[^@]*@([^:/]+).*#\1#')
  DB_PORT=$(echo "$DB_URL" | sed -E 's#^[a-z]+://[^@]*@[^:/]+:([0-9]+).*#\1#')
  mkdir -p certs
  echo | timeout 15 openssl s_client -starttls postgres -connect "$DB_HOST:$DB_PORT" -showcerts 2>/dev/null \
    | awk '/BEGIN CERT/{n++} n==2' | sed -n '/BEGIN CERT/,/END CERT/p' > certs/do-db-ca.crt
  chmod 644 certs/do-db-ca.crt
  sed -i -E 's#sslrootcert=[^&]*#sslrootcert=/certs/do-db-ca.crt#' "$ENV_FILE"
  echo "✓ Saved deploy/$ENV_FILE (only root on this server can read it)."
  echo "  Keep a copy of FIELD_ENCRYPTION_KEY somewhere safe later: without it, saved bank details cannot be read."
fi

COMPOSE="docker compose -f docker-compose.prod.yml"
echo
echo "== Creating the database tables =="
$COMPOSE run --rm --no-deps api node packages/database/scripts/prisma.mjs migrate deploy

echo
echo "== Your Super Admin login for admin.jamzo.in =="
read -r -p "Admin email: " ADMIN_EMAIL
while :; do
  read -r -s -p "Admin password (at least 12 characters, hidden): " ADMIN_PASSWORD; echo
  [ "${#ADMIN_PASSWORD}" -ge 12 ] && break
  echo "Too short — use at least 12 characters."
done
read -r -p "Add the demo restaurants (Pizza Point and others) to show people? [y/N]: " DEMO
SEED_DEMO=false; case "$DEMO" in y|Y|yes|YES) SEED_DEMO=true ;; esac
$COMPOSE run --rm --no-deps -e SEED_ADMIN_EMAIL="$ADMIN_EMAIL" -e SEED_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e SEED_ADMIN_NAME="Super Admin" -e SEED_DEMO="$SEED_DEMO" api node packages/database/src/seed/cli.js
unset ADMIN_PASSWORD

echo
echo "== Starting Jamzo =="
$COMPOSE up -d
for i in $(seq 1 30); do
  if $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "✓ Jamzo is running. Open https://admin.jamzo.in and sign in with the email above."
    exit 0
  fi
  sleep 2
done
echo "✗ Jamzo did not become ready yet. Tell Claude; logs: $COMPOSE logs api --tail 50" >&2
exit 1
