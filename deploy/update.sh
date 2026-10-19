#!/usr/bin/env bash
# Update the live server to the latest code on main (D-112): pull, rebuild both images, run migrations
# (expand-only), restart, and check /ready. Usage on the Droplet:  /opt/jamzo/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git fetch -q --depth 1 origin main
git reset -q --hard origin/main
echo "== Building $(git log --oneline -1) =="
docker build -q -f deploy/api.Dockerfile -t jamzo-api:latest .
docker build -q -f deploy/admin.Dockerfile -t jamzo-admin:latest .
cd deploy
COMPOSE="docker compose -f docker-compose.prod.yml"
$COMPOSE run --rm --no-deps api node packages/database/scripts/prisma.mjs migrate deploy
$COMPOSE up -d
# A changed Caddyfile or website needs no restart; Caddy reloads its configuration without dropping connections.
$COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
for i in $(seq 1 30); do
  if $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    docker image prune -f >/dev/null
    echo "✓ Updated and ready"
    exit 0
  fi
  sleep 2
done
echo "✗ Not ready after the update — check: $COMPOSE logs api --tail 50" >&2
exit 1
