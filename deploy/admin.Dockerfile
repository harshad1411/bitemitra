# Jamzo Admin image (D-101): Next.js standalone server. API_ORIGIN is fixed at build time (Next.js rewrites);
# in Docker Compose the API is reachable as http://api:4000.
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=$API_ORIGIN NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile --filter "@jamzo/admin..."
RUN pnpm --filter @jamzo/admin build

FROM base
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=node:node /app/apps/admin/public ./apps/admin/public
USER node
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
