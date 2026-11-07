# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS bun
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/runner/package.json ./packages/runner/package.json
RUN bun install --frozen-lockfile
COPY . .
RUN BUILD_STANDALONE=1 bun run build
# Keep the exact lockfile-resolved Playwright browser installer, without copying
# build tooling into the final image. The runner is a Bun isolated workspace.
RUN node scripts/copy-playwright.mjs /opt/playwright \
    && mkdir -p apps/web/public

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=1111 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /opt/playwright /opt/playwright
RUN node /opt/playwright/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown node:node /data
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 1111
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
