# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — installs every workspace dependency, builds the shared
# contracts package, generates the Prisma client, then compiles the API.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder

# argon2 is a native module and needs a toolchain to build from source.
RUN apk add --no-cache python3 make g++

RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile --filter @wms/api... --filter @wms/contracts

COPY packages/contracts packages/contracts
COPY apps/api apps/api

RUN pnpm --filter @wms/contracts build \
 && pnpm --filter @wms/api exec prisma generate \
 && pnpm --filter @wms/api build

# Strip development dependencies from the tree we are about to copy forward.
RUN pnpm install --frozen-lockfile --filter @wms/api... --filter @wms/contracts --prod

# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN corepack enable
WORKDIR /repo

ENV NODE_ENV=production

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

COPY --from=builder /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /repo/packages/contracts/node_modules ./packages/contracts/node_modules

COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/apps/api/prisma ./apps/api/prisma
COPY --from=builder /repo/apps/api/prisma.config.ts ./apps/api/prisma.config.ts

WORKDIR /repo/apps/api

# Run as an unprivileged user rather than root.
USER node

EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4300)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
