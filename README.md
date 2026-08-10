# Warehouse & Inventory Management System

Multi-tenant warehouse and inventory management: per-warehouse stock, an append-only movement ledger, replenishment thresholds, transfers, purchase and sales orders, fine-grained RBAC, background jobs and a REST API.

Built as the practical test for the **Senior Backend Developer** role at Praella.

| | |
| --- | --- |
| **API** | NestJS 11 · 74 REST operations · Swagger at `/docs` |
| **Dashboard** | Next.js 16 · App Router · Server Components + Server Actions |
| **Shared** | One Zod package used by both, so validation rules and the RBAC matrix exist exactly once |
| **Tests** | **160 passing** — 86 integration, 52 API unit, 22 frontend |

---

## Quick start

**Prerequisites:** Node.js ≥ 22, pnpm ≥ 10, Docker.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

pnpm bootstrap    # install, build shared package, start Postgres + Redis, migrate, seed
pnpm dev          # API on :4300, dashboard on :3300
```

| | |
| --- | --- |
| Dashboard | <http://localhost:3300> |
| Swagger UI | <http://localhost:4300/docs> |
| Health / metrics | `/health` · `/metrics` |

> Postgres runs on **5437** and Redis on **6381**, not their defaults, so the stack does not collide with anything already running.

Set `REDIS_ENABLED=false` to run without Redis: caching becomes a no-op and `/jobs` is not registered. Everything else works on Postgres alone.

---

## Demo accounts

**Password for every account: `Praella@2026`**

| Role | Email | Scope |
| --- | --- | --- |
| Admin | `admin@praella-wms.dev` | Everything, incl. deleting warehouses and managing members |
| Manager | `manager@praella-wms.dev` | All operations. No warehouse deletion, no member management |
| Staff | `staff@praella-wms.dev` | **Surat hub only.** View stock, record movements. No adjustments, no orders |
| Staff | `staff.mumbai@praella-wms.dev` | **Mumbai DC only** |
| Admin (2nd tenant) | `admin@northwind-wms.dev` | A separate organisation, proving tenant isolation |

Signing in as **Staff** is the fastest way to see access control working: the sidebar loses entries, the stock page loses its "Adjust stock" and "Set threshold" buttons, and only one warehouse's rows come back.

The seed builds 2 organisations, 5 users, 4 warehouses, 23 products, 375 movements across 30 days (all five movement types), 4 purchase orders, 4 sales orders and 1 transfer — with 8 lines deliberately below threshold.

---

## Tech stack

**Runtime** — Node 22.18 · PostgreSQL 16 · Redis 7.4 · pnpm 10.29 · Turborepo 2.5

**API** (`apps/api`)

| Library | Version | Why |
| --- | --- | --- |
| NestJS | 11.1 | Modules and guards map cleanly onto RBAC and multi-tenancy |
| Prisma | 7.9 | Type-safe queries; v7's `pg` driver adapter makes the pool explicit |
| Zod + nestjs-zod | 4.4 / 5.5 | Validation and OpenAPI generated from one schema |
| @nestjs/swagger | 11.4 | OpenAPI document + Swagger UI |
| @nestjs/jwt, passport-jwt | 11.0 / 4.0 | JWT access tokens |
| argon2 | 0.45 | Password hashing (argon2id) |
| BullMQ + @nestjs/bullmq | 6.0 / 11.0 | Background queue for bulk stock work |
| ioredis | 5.9 | Cache and queue transport |
| @nestjs/throttler, terminus | 6.5 / 11.1 | Rate limiting, health probes |
| helmet, compression | 8.1 / 1.8 | Security headers, gzip |
| Jest + Supertest | 30.2 / 7.1 | Unit and integration tests |

**Dashboard** (`apps/web`) — Next.js 16.3 · React 19.2 · Tailwind CSS 4 · Vitest 3 + React Testing Library. UI primitives are hand-rolled (~8 components); a component library plus Radix would have been more surface area than it saved, and native `<dialog>` already gives focus trapping and Escape-to-close.

**Shared** (`packages/contracts`) — Zod schemas, enums, the RBAC permission matrix, response types.

---

## Project structure

```
apps/api/           NestJS API
  prisma/           schema (21 models), migrations, deterministic seed
  src/
    auth/           sign-up/in, JWT rotation, password reset
    invitations/    signed invite links
    cache/          Redis cache, tenant-prefix invalidation
    catalogue/      categories, suppliers
    common/         guards, decorators, filters, utils
    exports/        streamed CSV exports
    jobs/           BullMQ queue + processor
    observability/  JSON logging, Prometheus metrics
    orders/         purchase + sales orders
    stock/          ledger, levels, movements, replenishment
    transfers/      warehouse-to-warehouse moves
  test/             integration specs
apps/web/           Next.js dashboard (14 routes)
packages/contracts/ shared Zod schemas + RBAC matrix
render.yaml         Render blueprint
scripts/deploy.sh   one-command deploy
sample-data.sql     generated sample data
```

---

## Environment variables

`apps/api/.env` — the app **refuses to boot** if any of these is missing or malformed; `src/config/env.config.ts` validates the whole environment with Zod and reports every problem at once.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4300` | |
| `DATABASE_URL` | local Postgres on 5437 | |
| `TEST_DATABASE_URL` | `…/wms_test` | Created automatically by the e2e suite |
| `REDIS_ENABLED` | `true` | `false` disables cache and queues entirely |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6381` | |
| `QUEUE_PREFIX` | `wms` | Namespaces BullMQ keys per environment |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev values | ≥ 32 chars, must differ from each other |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `900` / `1209600` | Seconds |
| `THROTTLE_LIMIT` / `AUTH_THROTTLE_LIMIT` | `200` / `10` | Global and auth-route rate limits |
| `APP_URL` | `http://localhost:3300` | Used to build invite and reset links |
| `MAIL_TRANSPORT` | `console` | Logs emails instead of sending them |
| `LOG_FORMAT` | json in production | |
| `CORS_ORIGINS` | `http://localhost:3300` | Comma-separated |

`apps/web/.env.local` — `API_BASE_URL` only. Server-side; the browser never receives it, and never receives a token either.

---

## Commands

```bash
pnpm dev / build / typecheck    # all packages via Turborepo
pnpm test                       # unit + frontend (74)
pnpm test:e2e                   # integration (86, needs Docker)

pnpm infra:up / infra:down / infra:reset
pnpm db:migrate / db:deploy / db:seed / db:studio / db:dump
```

---

## Testing

**160 tests, all passing.** Deliberately weighted towards integration: guard ordering, tenant scoping and transactional stock arithmetic are exactly what a mock-heavy unit test cannot see. Integration specs run the real application against a real PostgreSQL database (`wms_test`, created and migrated automatically) over HTTP.

| Spec | Covers |
| --- | --- |
| `auth` | Password policy, account-enumeration resistance, refresh rotation and reuse detection, error shape |
| `rbac` | The permission matrix, staff warehouse scoping, cross-tenant isolation, last-admin protection |
| `inventory` | CRUD, archive-vs-delete, pagination/search/sort, thresholds, dashboard, health probes |
| `stock-flows` | Movements, adjustments, **concurrent oversell protection**, transfers, PO receipt, SO allocation and fulfilment |
| `bulk-jobs` | The BullMQ queue end to end, with per-line error isolation |
| `rate-limit` | Rate limiting actually returning 429 |

Unit tests cover exact decimal arithmetic, the RFC 4180 CSV parser, pagination helpers, the RBAC matrix invariants and the ledger's guard rails. Frontend tests cover permission-gated navigation, composer line maths, the duplicate-product rule and the formatters.

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

## Sample data

1. **`pnpm db:seed`** — deterministic (seeded PRNG), so every run produces identical data.
2. **`sample-data.sql`** — ~530 rows across 19 tables as plain `INSERT`s, wrapped in a transaction and idempotent:
   ```bash
   pnpm db:deploy && psql "$DATABASE_URL" -f sample-data.sql
   ```

The seed does not invent stock numbers. It generates a chronological ledger and derives every stock level from it, so the signed sum of a product's movements in a warehouse always equals its on-hand quantity — the same invariant the running application maintains, asserted in the tests.

---

## How it works

### Multi-tenancy
Every tenant-owned row carries `organizationId`. A global guard resolves the active organisation from the `x-organization-id` header (or the user's sole membership) and attaches it to the request; every query filters on *that*, never on anything from the request body. Cross-tenant access is structurally impossible rather than merely unlikely.

### RBAC
Roles are bundles of permissions. The matrix lives in `packages/contracts/src/permissions.ts` and is the single source of truth. Guards check **permissions**, not roles:

```ts
@Delete(':id')
@RequirePermissions('warehouse:delete')   // only ADMIN holds this
```

The dashboard imports the same matrix to build its navigation and decide which buttons to render, so the UI can never offer an action the API would reject. `ADMIN` and `MANAGER` see every site; `STAFF` are restricted to their assigned warehouses, enforced in query filters and by an explicit check on every warehouse-targeted write.

### The stock ledger
`StockLevel` holds on-hand and reserved quantity per `(product, warehouse)`. `StockMovement` is append-only — rows are never updated or deleted.

Every stock change in the system passes through one method, `StockLedgerService.applyMovement`. Receipts, dispatches, transfers, manual adjustments and queued bulk jobs all call it, so there is exactly one place that can move a number and exactly one place that writes the matching ledger row. Nothing can change stock without leaving a trace, because no other code path exists.

Concurrency uses `SELECT … FOR UPDATE`. Two pickers dispatching the last unit at the same instant serialise on the row lock, so the second sees the first's decrement and is rejected.

### On hand vs. available
Sales orders separate *allocating* from *shipping*: `DRAFT → ALLOCATED → PARTIALLY_FULFILLED → FULFILLED`. Allocation reserves units without moving them, so two orders cannot promise the same last item; fulfilment converts the reservation into an outbound movement. A manual dispatch is refused if it would eat into stock another order has reserved.

### Transfers
`DRAFT → IN_TRANSIT → COMPLETED`. Stock leaves the source on dispatch and arrives on receipt, so goods in transit are correctly absent from both sites. A single-step transfer would overstate the destination's availability for as long as the lorry is on the road. Cancelling in transit returns stock to the source.

### Deleting things with history
Warehouses and products that carry stock or movement history are **archived**, not deleted — the ledger references them. Genuinely unused records are deleted outright. The API reports which it did and the UI shows that message verbatim.

### Concurrency on documents
Orders and transfers carry a `version`. An edit echoes the version it read, and a stale write gets a 409 naming both versions rather than silently winning. Optimistic rather than pessimistic, because an order can sit open in a browser tab for an hour and holding a row lock that long is not viable.

### Scalability
- **Queues** — bulk stock adjustments (up to 50 000 lines, JSON or CSV) run on BullMQ in chunked transactions. One giant transaction would hold row locks across the catalogue for minutes. A bad line fails only itself and is reported per-line.
- **Caching** — dashboard and low-stock are cached in Redis per organisation and warehouse scope, invalidated by tenant prefix (`SCAN` + `DEL`) on write. A Redis outage degrades latency, not availability.
- **Pagination** — every list is paginated with a hard cap of 100, and sorting is restricted to an allow-list so a caller cannot force a scan on an unindexed column.

### Security
Both tokens live in `httpOnly` cookies and never reach client-side JavaScript; all API calls are made from the Next.js server, and `proxy.ts` refreshes the access token when it nears expiry. Refresh tokens rotate, and replaying a rotated one revokes the whole family. Invitation and reset tokens are stored only as SHA-256 hashes. Password reset never reveals whether an address exists, and completing one revokes every session.

### Observability
JSON logs carry a correlation id via `AsyncLocalStorage`, so a line written deep in a service matches the `x-request-id` header the caller saw. `/metrics` exposes Prometheus counters and a latency histogram labelled by **route template** rather than concrete path — labelling by `/products/abc123` would mint a time series per product and eventually take Prometheus down.

---

## API

Swagger UI at `/docs`. All routes under `/api/v1`; send `Authorization: Bearer <token>` and `x-organization-id` when the user belongs to more than one organisation. `/health`, `/health/ready` and `/metrics` are version-neutral so a load balancer needs no reconfiguring when the API goes to v2.

Every failure returns the same body:

```json
{
  "statusCode": 422,
  "error": "Validation Failed",
  "message": "The request body or query string failed validation",
  "details": [{ "path": "unitPrice", "message": "Amount may have at most 2 decimal places" }],
  "path": "/api/v1/products",
  "timestamp": "2026-08-10T12:04:11.812Z",
  "requestId": "c034dd99-084a-4aea-8695-03e6e6fe7135"
}
```

`requestId` is echoed in the `x-request-id` header and appears in the logs, so a reported failure traces to one log line.

```bash
BASE=http://localhost:4300/api/v1
TOKEN=$(curl -s -X POST $BASE/auth/sign-in -H 'Content-Type: application/json' \
  -d '{"email":"manager@praella-wms.dev","password":"Praella@2026"}' | jq -r .tokens.accessToken)

curl -s $BASE/reports/dashboard    -H "Authorization: Bearer $TOKEN" | jq
curl -s $BASE/stock/low-stock      -H "Authorization: Bearer $TOKEN" | jq
curl -s $BASE/exports/products.csv -H "Authorization: Bearer $TOKEN"

# Bulk stock update from a CSV, applied on a background queue
curl -s -X POST $BASE/jobs/bulk-stock-adjustments/csv \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: text/csv' \
  --data-binary $'sku,warehouseCode,delta,reason\nELEC-MOU-02,SRT-HUB,5,Cycle count'
```

---

## Deployment

Both apps ship production Dockerfiles; the repo also carries a Render blueprint and a one-command deploy script.

```bash
RENDER_API_KEY=rnd_xxx DATABASE_URL=postgresql://... ./scripts/deploy.sh
```

That migrates and seeds the database, provisions Redis, creates the Render service and deploys the dashboard to Vercel.

**Topology:** managed Postgres (Neon) + Redis and the API container on Render + the dashboard on Vercel. The database is deliberately *not* Render's free tier, which expires after 30 days — the wrong property for a demo someone may open weeks later.

Manual equivalent:

```bash
docker build -f apps/api/Dockerfile -t wms-api .
docker run -p 4300:4300 \
  -e DATABASE_URL=... -e REDIS_HOST=... -e REDIS_PORT=... \
  -e JWT_ACCESS_SECRET=... -e JWT_REFRESH_SECRET=... \
  -e CORS_ORIGINS=https://your-dashboard -e APP_URL=https://your-dashboard \
  wms-api

DATABASE_URL=... pnpm --filter @wms/api prisma:deploy   # release step
```

**Before going live:** replace both JWT secrets with independent random values ≥ 32 chars, set `NODE_ENV=production` (cookies become `Secure`), point `CORS_ORIGINS` at the real origin, terminate TLS, and run `migrate deploy` — never `migrate dev`.

---

## Project summary

### Approach

I read the brief as asking for an inventory system that could be trusted with stock, not a CRUD app with a `quantity` column. Three decisions followed and shaped everything else.

**1. Stock is a ledger, not a column.** The obvious implementation increments `product.quantity` in place; that number is unauditable the moment anyone disputes it. Instead `StockLevel` holds current quantity per (product, warehouse) and `StockMovement` explains every change. Crucially *every* stock change routes through one method, so it is impossible to move stock without leaving a trace. The seed is built the same way and the tests assert the ledger reconciles.

**2. Permissions, not roles, at the boundary.** The brief asks for fine-grained permissions. Scattering `if (role === 'ADMIN')` works until the fourth role arrives. One `resource:action` matrix in the shared package, guards check permissions, roles are bundles. Adding a role later touches one file — and the dashboard reads the same matrix, so UI and API cannot disagree.

**3. One definition of every contract.** `packages/contracts` holds the schemas, the matrix and the response types. The API generates DTOs and its OpenAPI document from them; the web app validates forms and types responses with them. No second copy to drift.

Beyond that: multi-tenancy enforced by a guard rather than by remembering to filter; money as `Decimal` in Postgres and a string on the wire; concurrency handled with row locks and proven by a test that fires ten simultaneous dispatches.

I built the API first and drove it from the command line until every flow was correct, then wrote the tests, then the dashboard.

### What I liked

The **shared contracts package** paid for itself repeatedly — changing a validation rule updates the API, the OpenAPI document and the frontend form in one edit, and a mismatch is a compile error rather than a bug report.

The **single-choke-point ledger** was the highest-leverage decision. Once `applyMovement` existed, receipts, transfers, fulfilment and bulk jobs were each about twenty lines and all inherited oversell protection, reservation checks and audit history for free.

**Modelling reservations separately from on-hand stock** was more interesting than expected. It is the difference between "500 in the warehouse" and "500, of which 450 are promised" — and the difference between a system you can and cannot trust to accept an order.

### What I disliked

**Next.js 16's server/client boundary rules cost me real time.** A `'use server'` file may only export async functions, so exporting an `IDLE` constant alongside the actions breaks the module — with an error pointing at the file's last line rather than the offending export. Separately, passing a render-prop as `children` from a Server Component to a Client Component fails at runtime, not compile time. Both were quick to fix once diagnosed and slow to diagnose.

**Render's one-free-database-per-account limit** forced an external Postgres. That turned out better — Render's free database expires after 30 days, which is exactly wrong for a demo link — but it was not the shape I planned.

**The two-decimal money rule is unfashionably strict** and I stand by it, though it does mean a client sending `1.005` gets a 422 rather than silent rounding.

### Challenges

**Concurrent stock updates.** Read-modify-write on a stock level is a textbook race. I used `SELECT … FOR UPDATE` inside the transaction — simple, obviously correct, easy to explain. A conditional `UPDATE … WHERE quantity >= n` is one query cheaper, but expressing "and don't eat into reserved stock" that way gets unreadable fast.

**Attributing a transfer to a warehouse.** My first schema gave movements a source/destination pair. It reads naturally until you ask "which site's balance did this row change?" — for a transfer both are populated and the answer is ambiguous. I caught it writing a reconciliation query that reported six mismatches; the data was fine, my query could not be expressed. Replaced with a required `warehouseId` plus an optional counterpart, reconstructing "from → to" in the view layer.

**A "flaky" test that was really cross-environment contamination.** The bulk-job spec failed about one run in four. Not timing: the test suite and a running dev server shared one BullMQ queue, so either worker could claim a job while connected to the *other* database. Fixed by namespacing queue keys with `QUEUE_PREFIX`, verified by running the suite five times with the dev server deliberately left running.

**Rate limiting versus the test suite.** Overriding the guard does not work, because `APP_GUARD` instantiates it directly rather than resolving the class token. The fix was to make the limit environment-driven — which it should have been anyway — and have the setup raise it for every spec except the one proving rate limiting works.

**Two routes served under the wrong prefix.** `/health` was answering on `/v1/health`, and later `/metrics` had the same problem: URI versioning applies even to routes excluded from the global prefix. Both now use `VERSION_NEUTRAL`. An integration test caught the first; the second I caught only because I went looking after fixing the first.

**A claim in this README that was wrong.** An earlier version stated that Prisma cannot compare two columns, and the low-stock threshold was therefore filtered in JavaScript. Prisma supports field references, and doing it in JS was also a real bug — filtering *after* the page was taken made `totalItems` disagree with the rows returned. Both fixed.

### Time spent

**Roughly 16–18 hours**, including a second pass that closed the original pending list.

| | |
| --- | --- |
| Schema, migrations, seed | ~2h |
| Auth, RBAC, multi-tenancy | ~1.5h |
| Inventory, ledger, transfers, orders | ~2.5h |
| Queues, caching, reports | ~1h |
| Invitations, password reset, CSV, observability, concurrency | ~3h |
| Tests (160) | ~2.5h |
| Dashboard, composers, responsive | ~3.5h |
| README, Docker, deployment | ~1.5h |

### Pending items

1. **A generated `is_below_threshold` column.** The threshold comparison now runs in Postgres via a field reference with a supporting index. At much larger scale a stored generated column would let the predicate itself be indexed.
2. **Editing order lines after creation.** Orders can be created, transitioned and cancelled from the UI; changing a line on an existing draft is still API-only.
3. **A real email provider.** `MailerService` has one transport that logs, so invitations and resets work end to end with no configuration. Swapping in Postmark or SES means implementing one method.
4. **Deeper frontend tests.** 22 specs cover the highest-risk client logic; page-level Server Components are covered indirectly by the API suite and by browser QA across all three roles at six breakpoints.
5. **Distributed tracing.** Structured logs and Prometheus metrics are in place and the correlation-id plumbing is ready; OpenTelemetry spans would be the next step.

---

## Notes for the reviewer

- Sign in as `staff@praella-wms.dev` and compare with `admin@praella-wms.dev` — that contrast is the whole RBAC story in ten seconds.
- `pnpm test:e2e` needs Docker; it creates and migrates its own `wms_test` database and never touches development data.
- Swagger has "Try it out" enabled — sign in, click **Authorize**, paste the access token, and every endpoint is callable from the browser.
- Invitation and password-reset emails are printed to the API log, so both flows can be completed locally without a mail provider.
- The dashboard is responsive from 375 px up; navigation collapses to a drawer below `lg`.
