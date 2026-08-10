# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @wms/web... --filter @wms/contracts

COPY packages/contracts packages/contracts
COPY apps/web apps/web

RUN pnpm --filter @wms/contracts build \
 && pnpm --filter @wms/web build

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN corepack enable
WORKDIR /repo

ENV NODE_ENV=production
ENV PORT=3300

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

COPY --from=builder /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /repo/packages/contracts/package.json ./packages/contracts/package.json

COPY --from=builder /repo/apps/web/.next ./apps/web/.next
COPY --from=builder /repo/apps/web/public ./apps/web/public
COPY --from=builder /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /repo/apps/web/package.json ./apps/web/package.json
COPY --from=builder /repo/apps/web/next.config.ts ./apps/web/next.config.ts

WORKDIR /repo/apps/web

USER node

EXPOSE 3300

CMD ["pnpm", "start"]
