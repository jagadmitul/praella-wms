# Warehouse & Inventory Management System

Multi-tenant warehouse and inventory management: per-warehouse stock, an append-only movement ledger, replenishment thresholds, transfers, purchase and sales orders, fine-grained RBAC, background jobs and a REST API.

Praella Senior Backend practical test.

**Live:** [praella-wms.vercel.app](https://praella-wms.vercel.app) · **API:** [wms-api-9yar.onrender.com](https://wms-api-9yar.onrender.com/api/v1) · **Swagger:** [/docs](https://wms-api-9yar.onrender.com/docs)

Sign in as `admin@praella-wms.dev` / `Praella@2026`, then compare with `staff@praella-wms.dev` (same password) — that contrast is the RBAC story in ten seconds.

> The API is on Render's free tier and sleeps after 15 minutes idle, so the first request may take up to a minute while it wakes.

---

## Quick start

Prerequisites: Node ≥ 22, pnpm ≥ 10, Docker.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

pnpm bootstrap    # install, build shared package, start Postgres + Redis, migrate, seed
pnpm dev          # API on :4300, dashboard on :3300
```

Postgres runs on **5437** and Redis on **6381** to avoid clashing with anything already running. Set `REDIS_ENABLED=false` to run without Redis — caching becomes a no-op and `/jobs` is not registered.

### Commands

```bash
pnpm build / typecheck / lint
pnpm test                 # 78 unit + frontend
pnpm --filter @wms/api openapi   # regenerate apps/api/openapi.json
pnpm test:e2e             # 86 integration (needs Docker)
pnpm db:migrate | db:deploy | db:seed | db:studio | db:dump
pnpm infra:up | infra:down | infra:reset
```

---

## Demo accounts

Password for all: **`Praella@2026`**

| Role | Email | Scope |
| --- | --- | --- |
| Admin | `admin@praella-wms.dev` | Everything, incl. deleting warehouses and managing members |
| Manager | `manager@praella-wms.dev` | All operations. No warehouse deletion, no member management |
| Staff | `staff@praella-wms.dev` | **Surat hub only.** View stock, record movements. No adjustments, no orders |
| Staff | `staff.mumbai@praella-wms.dev` | **Mumbai DC only** |
| Admin (2nd tenant) | `admin@northwind-wms.dev` | Separate organisation, proving tenant isolation |

---

## Tech stack

**Runtime** — Node 22.18 · PostgreSQL 16 (Neon 18 in production) · Redis 7.4 · pnpm 10.29 · Turborepo 2.5

**API** (`apps/api`) — NestJS 11.1 · Prisma 7.9 (`pg` driver adapter) · Zod 4.4 + nestjs-zod 5.5 · @nestjs/swagger 11.4 · @nestjs/jwt 11 + passport-jwt 4 · argon2 0.45 · BullMQ 6 + @nestjs/bullmq 11 · ioredis 5.9 · @nestjs/throttler 6.5 · @nestjs/terminus 11.1 · nodemailer 7 · OpenTelemetry SDK 0.209 · helmet 8.1 · compression 1.8 · Jest 30 + Supertest 7

**Dashboard** (`apps/web`) — Next.js 16.3 · React 19.2 · Tailwind CSS 4 · Vitest 3 + React Testing Library 16

**Shared** (`packages/contracts`) — Zod schemas, enums, the RBAC permission matrix and response types, imported by both apps.

UI primitives are hand-rolled (~10 components). A component library plus Radix would have been more surface area than it saved at this size, and native `<dialog>` already provides focus trapping and Escape-to-close.

---

## Structure

```
apps/api/            NestJS API — 80 REST operations
  prisma/            schema (21 models), migrations, deterministic seed
  src/auth           sign-up/in, JWT rotation, password reset
      invitations    signed, single-use invite links
      warehouses     products  catalogue  stock  transfers  orders
      cache          Redis cache, tenant-prefix invalidation
      jobs           BullMQ queue + processor
      exports        streamed CSV
      observability  JSON logs, Prometheus metrics, OpenTelemetry
      common         guards, decorators, filters, utils
  test/              6 integration specs
apps/web/            Next.js dashboard, 14 routes
packages/contracts/  shared Zod schemas + RBAC matrix
render.yaml · scripts/deploy.sh · sample-data.sql
```

---

## Environment variables

The API **refuses to boot** if any of these is missing or malformed — `src/config/env.config.ts` validates the whole environment with Zod and reports every problem at once.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4300` | |
| `DATABASE_URL` | local Postgres :5437 | |
| `TEST_DATABASE_URL` | `…/wms_test` | Created automatically by the e2e suite |
| `REDIS_ENABLED` | `true` | `false` disables cache and queues entirely |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6381` | |
| `QUEUE_PREFIX` | `wms` | Namespaces BullMQ keys per environment |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev values | ≥ 32 chars, must differ |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `900` / `1209600` | Seconds |
| `THROTTLE_LIMIT` / `AUTH_THROTTLE_LIMIT` | `200` / `10` | Global and auth-route limits |
| `APP_URL` | `http://localhost:3300` | Builds invite and reset links |
| `CORS_ORIGINS` | `http://localhost:3300` | Comma-separated |
| `MAIL_TRANSPORT` | `console` | `console` logs emails; `smtp` sends via `SMTP_*` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | — | Required when `MAIL_TRANSPORT=smtp` |
| `LOG_FORMAT` | json in production | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Set to enable distributed tracing |

`apps/web/.env.local` needs only `API_BASE_URL`. It is server-side; the browser never receives it, and never receives a token either.

---

## Sample data

1. **`pnpm db:seed`** — deterministic (seeded PRNG), so every run produces identical data.
2. **`sample-data.sql`** — ~530 rows across 19 tables as plain `INSERT`s, idempotent and wrapped in a transaction:
   ```bash
   pnpm db:deploy && psql "$DATABASE_URL" -f sample-data.sql
   ```

The seed builds 2 organisations, 5 users, 4 warehouses, 23 products, 375 movements over 30 days (all five movement types), 4 purchase orders, 4 sales orders and 1 transfer, with 8 lines below threshold.

It does not invent stock numbers: it generates a chronological ledger and derives every stock level from it, so the signed sum of a product's movements always equals its on-hand quantity — the same invariant the running application maintains.

---

## Testing

**164 tests, all passing** — 86 integration, 52 API unit, 26 frontend.

Weighted towards integration on purpose: guard ordering, tenant scoping and transactional stock arithmetic are exactly what a mock-heavy unit test cannot see. Integration specs run the real application against a real PostgreSQL database (`wms_test`, created and migrated automatically) over HTTP.

| Spec | Covers |
| --- | --- |
| `auth` | Password policy, account-enumeration resistance, refresh rotation and reuse detection, error shape |
| `rbac` | Permission matrix, staff warehouse scoping, cross-tenant isolation, last-admin protection |
| `inventory` | CRUD, archive-vs-delete, pagination/search/sort, thresholds, dashboard, health probes |
| `stock-flows` | Movements, adjustments, **concurrent oversell protection**, transfers, PO receipt, SO allocation and fulfilment |
| `bulk-jobs` | BullMQ queue end to end with per-line error isolation |
| `rate-limit` | Rate limiting returning 429 |

The test worth reading:

```ts
it('never lets concurrent dispatches drive stock negative', async () => {
  // Ten simultaneous requests for 100 units each, against 500 on hand.
  const results = await Promise.all(attempts);
  expect(results.filter(r => r.status === 201).length).toBe(5);   // exactly five win
  expect((await level(warehouseA)).quantity).toBe(0);             // never negative
});
```

---

## Design notes

**Multi-tenancy.** Every tenant-owned row carries `organizationId`. A global guard resolves the active organisation and attaches it to the request; every query filters on *that*, never on anything from the request body.

**RBAC.** Roles are bundles of permissions. One `resource:action` matrix in `packages/contracts` is the single source of truth, and guards check permissions rather than roles:

```ts
@Delete(':id')
@RequirePermissions('warehouse:delete')   // only ADMIN holds this
```

The dashboard imports the same matrix to build its navigation, so the UI cannot offer an action the API would reject. `STAFF` are further restricted to their assigned warehouses.

**Stock is a ledger, not a column.** `StockLevel` holds on-hand and reserved quantity per (product, warehouse); `StockMovement` is append-only. Every stock change in the system passes through one method, `StockLedgerService.applyMovement` — receipts, dispatches, transfers, adjustments and queued jobs all call it. Nothing can change stock without leaving a trace, because no other code path exists. Concurrency uses `SELECT … FOR UPDATE`.

**On hand vs. available.** Sales orders separate allocating from shipping (`DRAFT → ALLOCATED → PARTIALLY_FULFILLED → FULFILLED`). Allocation reserves units without moving them, so two orders cannot promise the same last item.

**Transfers** hold goods in transit: stock leaves the source on dispatch and arrives on receipt, so it is correctly absent from both sites in between.

**Deleting things with history.** Warehouses and products that carry stock or movement history are archived, not deleted — the ledger references them. Genuinely unused records are deleted outright.

**Bulk actions** are deliberately *not* transactional across the set. Ten orders where three are in the wrong state is the normal case; each record is attempted independently and the response names exactly which failed and why.

**Scalability.** Bulk stock jobs (up to 50 000 lines, JSON or CSV) run on BullMQ in chunked transactions. Dashboard and low-stock are cached in Redis per organisation and warehouse scope, invalidated by tenant prefix. Every list is paginated with a hard cap of 100 and sorting restricted to an allow-list.

**Security.** Both tokens live in `httpOnly` cookies and never reach client-side JavaScript. Refresh tokens rotate, and replaying a rotated one revokes the family. Invitation and reset tokens are stored only as SHA-256 hashes. Password reset never reveals whether an address exists.

**Observability.** JSON logs carry a correlation id via `AsyncLocalStorage`, matching the `x-request-id` header. `/metrics` exposes Prometheus counters and a latency histogram labelled by route *template* — labelling by concrete path would mint a time series per product. OpenTelemetry tracing is available, off unless an OTLP endpoint is configured.

---

## API

Swagger at `/docs`. All routes under `/api/v1`; send `Authorization: Bearer <token>`, and `x-organization-id` when the user belongs to more than one organisation. `/health`, `/health/ready` and `/metrics` are version-neutral so a load balancer needs no reconfiguring at v2.

The document is complete rather than decorative: all 80 operations carry a typed request body or query schema, a typed 2xx response, and the failure codes that operation can actually return — derived from the exceptions its service throws, not blanket-applied. `pnpm --filter @wms/api openapi` regenerates the committed [`apps/api/openapi.json`](apps/api/openapi.json), so an undocumented API change shows up as a diff in review.

Request and response schemas come from the same Zod definitions in `packages/contracts`, each written as `satisfies z.ZodType<TheInterface>` — so a response shape that drifts from its TypeScript type fails the build rather than quietly misleading whoever generates a client from the spec.

Every failure returns the same shape, with a `requestId` that is echoed in the `x-request-id` header and appears in the logs:

```json
{
  "statusCode": 422,
  "error": "Validation Failed",
  "message": "The request body or query string failed validation",
  "details": [{ "path": "unitPrice", "message": "Amount may have at most 2 decimal places" }],
  "path": "/api/v1/products",
  "timestamp": "2026-08-11T09:04:11.812Z",
  "requestId": "c034dd99-084a-4aea-8695-03e6e6fe7135"
}
```

```bash
BASE=https://wms-api-9yar.onrender.com/api/v1
TOKEN=$(curl -s -X POST $BASE/auth/sign-in -H 'Content-Type: application/json' \
  -d '{"email":"manager@praella-wms.dev","password":"Praella@2026"}' | jq -r .tokens.accessToken)

curl -s $BASE/reports/dashboard -H "Authorization: Bearer $TOKEN" | jq
curl -s $BASE/stock/low-stock   -H "Authorization: Bearer $TOKEN" | jq

# Bulk stock update from CSV, applied on a background queue
curl -s -X POST $BASE/jobs/bulk-stock-adjustments/csv \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: text/csv' \
  --data-binary $'sku,warehouseCode,delta,reason\nELEC-MOU-02,SRT-HUB,5,Cycle count'
```

---

## Deployment

Deployed as: Postgres on **Neon**, Redis and the API container on **Render**, dashboard on **Vercel** — all auto-deploying from `main`. The database is deliberately not Render's free tier, which expires after 30 days.

```bash
RENDER_API_KEY=... DATABASE_URL=postgresql://... ./scripts/deploy.sh
```

That migrates, seeds, provisions Redis, creates the Render service and deploys the dashboard. `render.yaml` is also a one-click Blueprint. Both apps have production Dockerfiles:

```bash
docker build -f apps/api/Dockerfile -t wms-api .
DATABASE_URL=... pnpm --filter @wms/api prisma:deploy   # release step
```

Before going live: replace both JWT secrets with independent random values ≥ 32 chars, set `NODE_ENV=production` (cookies become `Secure`), point `CORS_ORIGINS` at the real origin, and run `migrate deploy` — never `migrate dev`.

---

## Project summary

**Approach.** I read the brief as asking for an inventory system that could be trusted with stock, not a CRUD app with a `quantity` column. Three decisions followed: stock is an append-only ledger with a single choke point, so nothing can move it without leaving a trace; guards check fine-grained permissions rather than roles, from one matrix shared with the frontend; and every contract — validation, RBAC, response types — is defined once in a shared package that both apps import. Beyond that, multi-tenancy is enforced by a guard rather than by remembering to filter, money is `Decimal` in Postgres and a string on the wire, and concurrency is handled with row locks. I built the API first and drove it from the command line until every flow was correct, then wrote the tests, then the dashboard.

**Liked.** The shared contracts package paid for itself repeatedly — one edit updates the API, the OpenAPI document and the frontend form, and a mismatch is a compile error. The single-choke-point ledger was the highest-leverage decision: once `applyMovement` existed, receipts, transfers, fulfilment and bulk jobs were each about twenty lines and inherited oversell protection and audit history for free.

**Disliked.** Next.js 16's server/client boundary rules cost real time — a `'use server'` file may only export async functions, and passing a render-prop as `children` across the boundary fails at runtime rather than compile time. Both were quick to fix and slow to diagnose. Prisma also has no syntax for generated columns, which sent me down a dead end when indexing the replenishment predicate: a `STORED` column works, but Prisma models it as a `DEFAULT`, so every later `migrate dev` wanted to rewrite it. A partial index carrying the column comparison in its `WHERE` clause achieves the same result with no drift at all.

**Challenges.** Concurrent stock updates are a textbook race; I used `SELECT … FOR UPDATE` and wrote a test that fires ten simultaneous dispatches to prove exactly five win. My first schema gave movements a source/destination pair, which is ambiguous for transfers — "which site's balance changed?" has two answers — so it became a required `warehouseId` plus an optional counterpart. A bulk-job spec that failed one run in four turned out not to be timing at all: the test suite and a running dev server shared one BullMQ queue, so either worker could claim a job while connected to the other's database; queue keys are now namespaced. And `/health` was being served at `/v1/health` because URI versioning applies even to routes excluded from the global prefix.

**Time spent.** Roughly 20–22 hours across three sessions: the core build, then closing the pending list, then UI polish and deployment.

**Pending items.**
1. **Editing order lines in the UI.** The API supports it (`PUT /{purchase,sales}-orders/:id/items`, draft-only and version-checked); the dashboard composer still only creates.
2. **Per-line receiving and fulfilment in the UI.** The API takes partial quantities per line; the dashboard receives or ships in full.
3. **Deeper frontend tests.** 22 specs cover the highest-risk client logic; page-level Server Components are covered indirectly by the API suite and by browser QA across all three roles at six breakpoints.
4. **Trace-to-log correlation in a collector.** Spans carry `wms.request_id` and logs carry the same value; joining them automatically is deployment configuration rather than code.

---

## Notes for the reviewer

- Sign in as `staff@praella-wms.dev` and compare with `admin@praella-wms.dev` — the sidebar, the buttons and the visible warehouses all change.
- `pnpm test:e2e` needs Docker; it creates and migrates its own `wms_test` database and never touches development data.
- Swagger has "Try it out" enabled — sign in, click **Authorize**, paste the access token, and every endpoint is callable from the browser.
- Invitation and password-reset emails are printed to the API log, so both flows complete locally without a mail provider.
- The dashboard is responsive from 375 px up; navigation collapses to a drawer below `lg`.
