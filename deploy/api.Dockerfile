# Jamzo API + worker image (D-101): one image, two commands.
#   API:     node services/api/src/server.js
#   worker:  node services/workers/src/main.js
#   migrate: node packages/database/scripts/prisma.mjs migrate deploy
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app

FROM base AS build
COPY . .
# Only what the API and the worker need; @jamzo/database's postinstall generates the Prisma client.
RUN pnpm install --frozen-lockfile --filter "@jamzo/api..." --filter "@jamzo/workers..."

FROM base
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/api/src/server.js"]
