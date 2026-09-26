#!/usr/bin/env bash
# Deploy a release on the Droplet (D-101). Usage: deploy/deploy.sh <image tag>
# 1) pull the images, 2) run migrations (expand-only), 3) restart the containers, 4) check readiness.
# Rollback: run this again with the previous tag (migrations are expand-only, so the old code still works).
set -euo pipefail
TAG="${1:?usage: deploy/deploy.sh <tag>}"
cd "$(dirname "$0")"
export JAMZO_API_IMAGE="${JAMZO_REGISTRY:?set JAMZO_REGISTRY}/jamzo-api:${TAG}"
export JAMZO_ADMIN_IMAGE="${JAMZO_REGISTRY}/jamzo-admin:${TAG}"
docker compose -f docker-compose.prod.yml pull api admin
docker compose -f docker-compose.prod.yml run --rm api node packages/database/scripts/prisma.mjs migrate deploy
docker compose -f docker-compose.prod.yml up -d
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T api node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "✓ ${TAG} is live and ready"; exit 0
  fi
  sleep 2
done
echo "✗ ${TAG} did not become ready — roll back with the previous tag" >&2
exit 1
