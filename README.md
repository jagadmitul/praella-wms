# Warehouse & Inventory Management System

A multi-tenant warehouse and inventory management platform: multi-warehouse stock tracking, an append-only movement ledger, replenishment thresholds, warehouse transfers, purchase and sales orders, fine-grained RBAC, background jobs and a REST API.

Built as the practical test for the **Senior Backend Developer** role at Praella.

- **API** — NestJS 11 REST API, 63 routes, documented with Swagger
- **Web** — Next.js 16 dashboard (App Router, Server Components, Server Actions)
- **Shared** — one Zod contracts package used by *both*, so validation rules and the RBAC matrix exist exactly once

---

## Table of contents

- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Environment variables](#environment-variables)
- [Everyday commands](#everyday-commands)
- [Testing](#testing)
- [Sample data](#sample-data)
- [How it works](#how-it-works)
- [API reference](#api-reference)
- [Deployment](#deployment)
- [Project summary](#project-summary)

---

## Quick start

**Prerequisites:** Node.js ≥ 22, pnpm ≥ 10, Docker (for PostgreSQL and Redis).

```bash
git clone <this-repo> praella-wms
cd praella-wms

# Environment files (defaults work out of the box for local development)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# Install, build the shared package, start Postgres + Redis, migrate and seed
pnpm bootstrap

# Run the API (:4300) and the dashboard (:3300) together
pnpm dev
```

Then open:

| What | URL |
| --- | --- |
| Dashboard | <http://localhost:3300> |
| API base | <http://localhost:4300/api/v1> |
| Swagger UI | <http://localhost:4300/docs> |
| Health probe | <http://localhost:4300/health> |

> **Ports.** Postgres runs on **5437** and Redis on **6381** (not their defaults) so the stack does not collide with anything else already running on your machine. Change them in `docker-compose.yml` and `apps/api/.env` if you prefer.

`pnpm bootstrap` is shorthand for:

```bash
pnpm install
pnpm --filter @wms/contracts build   # the API and web app both import this
pnpm infra:up                        # docker compose up -d
pnpm db:deploy                       # prisma migrate deploy
pnpm db:seed                         # realistic demo data
```

### Running without Redis

Set `REDIS_ENABLED=false` in `apps/api/.env`. Caching becomes a no-op and the `/jobs` routes are not registered; everything else works against Postgres alone.

---

## Demo accounts

Seeded by `pnpm db:seed`. **Password for every account: `Praella@2026`**

| Role | Email | What they can see and do |
| --- | --- | --- |
| **Admin** | `admin@praella-wms.dev` | Everything, including deleting warehouses and managing members |
| **Manager** | `manager@praella-wms.dev` | All operations — products, stock adjustments, transfers, orders, thresholds. No warehouse deletion, no member management |
| **Staff** | `staff@praella-wms.dev` | **Surat hub only.** View stock, record inbound/outbound movements. Cannot adjust stock or raise orders |
| **Staff** | `staff.mumbai@praella-wms.dev` | **Mumbai DC only** — same permissions, different site |
| **Admin (other tenant)** | `admin@northwind-wms.dev` | A second organisation, to demonstrate that tenant data is genuinely isolated |

Signing in as **Staff** is the quickest way to see the access control working: the sidebar loses entries, the stock page loses its "Adjust stock" and "Set threshold" buttons, and only one warehouse's rows are returned.

The seed creates 2 organisations, 5 users, 4 warehouses, 23 products, 67 stock levels, **379 stock movements across 30 days**, 4 purchase orders, 4 sales orders and 1 completed transfer — with 9 lines deliberately below their replenishment threshold so the low-stock features have something to show.

---

## Tech stack

### Runtime

| | Version |
| --- | --- |
| Node.js | 22.18 |
| PostgreSQL | 16.14 |
| Redis | 7.4 |
| pnpm | 10.29 |

### API — `apps/api`

| Library | Version | Why |
| --- | --- | --- |
| NestJS | 11.1 | Modules/providers/guards map cleanly onto RBAC and multi-tenancy |
| Prisma ORM | 7.9 | Type-safe queries; v7 uses a `pg` driver adapter, so the connection pool is explicit |
| `@prisma/adapter-pg` + `pg` | 7.9 / 8.16 | Driver adapter and pool |
| Zod | 4.4 | Runtime validation, shared with the web app |
| `nestjs-zod` | 5.5 | Generates DTOs and OpenAPI schemas from the Zod schemas |
| `@nestjs/swagger` | 11.4 | OpenAPI document and Swagger UI |
| `@nestjs/jwt` + `passport-jwt` | 11.0 / 4.0 | JWT access tokens |
| argon2 | 0.45 | Password hashing (argon2id) |
| BullMQ + `@nestjs/bullmq` | 6.0 / 11.0 | Background queue for bulk stock work |
| ioredis | 5.9 | Redis client for cache and queue |
| `@nestjs/throttler` | 6.5 | Rate limiting |
| `@nestjs/terminus` | 11.1 | Liveness and readiness probes |
| helmet, compression | 8.1 / 1.8 | Security headers, gzip |
| Jest + Supertest | 30.2 / 7.1 | Unit and integration tests |

### Web — `apps/web`

| Library | Version | Why |
| --- | --- | --- |
| Next.js | 16.3 | App Router, Server Components, Server Actions |
| React | 19.2 | |
| Tailwind CSS | 4.x | Utility styling with `@theme` design tokens |
| TypeScript | 5.9 | |

UI components are hand-rolled (≈8 primitives in `components/ui`). A component library plus Radix would have added far more surface area than it saved at this size, and the native `<dialog>` element already provides focus trapping and Escape-to-close.

### Shared — `packages/contracts`

Zod schemas, enums, the RBAC permission matrix and response types. Imported by the API for validation and OpenAPI generation, and by the web app for form validation and typed responses.

---

## Project structure

```
praella-wms/
├── apps/
│   ├── api/                       NestJS REST API
│   │   ├── prisma/
│   │   │   ├── schema.prisma      19 models
│   │   │   ├── migrations/        SQL migration history
│   │   │   └── seed.ts            Deterministic demo data
│   │   ├── scripts/
│   │   │   └── dump-sample-data.ts
│   │   ├── src/
│   │   │   ├── auth/              Sign-up, sign-in, JWT rotation
│   │   │   ├── cache/             Redis cache with tenant-prefix invalidation
│   │   │   ├── catalogue/         Categories, suppliers
│   │   │   ├── common/            Guards, decorators, filters, utils
│   │   │   ├── config/            Zod-validated environment
│   │   │   ├── health/            Liveness / readiness
│   │   │   ├── jobs/              BullMQ queue + processor
│   │   │   ├── orders/            Purchase + sales orders
│   │   │   ├── organizations/     Members, roles, invitations
│   │   │   ├── products/
│   │   │   ├── reports/           Dashboard aggregates
│   │   │   ├── stock/             Ledger, levels, movements, replenishment
│   │   │   ├── transfers/         Warehouse-to-warehouse moves
│   │   │   └── warehouses/
│   │   └── test/                  Integration (e2e) specs
│   └── web/                       Next.js dashboard
│       ├── app/(auth)/            Sign in, sign up
│       ├── app/(dashboard)/       11 authenticated pages
│       ├── components/
│       ├── lib/                   API client, session, server actions
│       └── proxy.ts               Token refresh + route guard
├── packages/contracts/            Shared Zod schemas + RBAC matrix
├── docker-compose.yml             Postgres + Redis
└── sample-data.sql                Generated sample data
```

---

## Environment variables

### `apps/api/.env` (copy from `.env.example`)

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | |
| `PORT` | `4300` | |
| `CORS_ORIGINS` | `http://localhost:3300` | Comma-separated |
| `DATABASE_URL` | `postgresql://wms:wms_password@localhost:5437/wms` | |
| `TEST_DATABASE_URL` | `…/wms_test` | Created automatically by the e2e suite |
| `REDIS_ENABLED` | `true` | `false` disables cache + queues entirely |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6381` | |
| `QUEUE_PREFIX` | `wms` | Namespaces BullMQ keys; give each environment its own value |
| `JWT_ACCESS_SECRET` | dev value | **Must be ≥ 32 chars and different from the refresh secret** |
| `JWT_REFRESH_SECRET` | dev value | |
| `JWT_ACCESS_TTL` | `900` | Seconds |
| `JWT_REFRESH_TTL` | `1209600` | Seconds (14 days) |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | `60` / `200` | Global rate limit |
| `AUTH_THROTTLE_LIMIT` | `10` | Tighter limit for sign-in / sign-up |
| `CACHE_TTL_SECONDS` | `60` | |
| `SEED_PASSWORD` | `Praella@2026` | Password given to every seeded account |

The application **refuses to boot** if any of these is missing or malformed — `src/config/env.config.ts` validates the whole environment with Zod and reports every problem at once.

### `apps/web/.env.local`

| Variable | Default |
| --- | --- |
| `API_BASE_URL` | `http://localhost:4300/api/v1` |

Server-side only. The browser never receives it, and never receives an API token either.

---

## Everyday commands

```bash
pnpm dev              # API + web together (Turborepo)
pnpm build            # Build all three packages
pnpm typecheck        # Type-check everything
pnpm test             # Unit tests
pnpm test:e2e         # Integration tests (needs Docker running)

pnpm infra:up         # Start Postgres + Redis
pnpm infra:down       # Stop them
pnpm infra:reset      # Stop, delete volumes, start fresh

pnpm db:migrate       # Create a new migration (development)
pnpm db:deploy        # Apply migrations (CI / production)
pnpm db:seed          # Reset and re-seed demo data
pnpm db:studio        # Prisma Studio
pnpm db:dump          # Regenerate sample-data.sql
```

---

## Testing

```bash
pnpm test        # 38 unit tests
pnpm test:e2e    # 86 integration tests
```

**124 tests, all passing.** The suite is deliberately weighted towards integration tests: the things most worth protecting here — guard ordering, tenant scoping, transactional stock arithmetic — are exactly the things a mock-heavy unit test cannot see.

Integration tests run the real Nest application against a real PostgreSQL database (`wms_test`, created and migrated automatically), driven over HTTP with Supertest.

| Spec | Covers |
| --- | --- |
| `auth.e2e-spec.ts` | Sign-up/in, password policy, account-enumeration resistance, refresh-token rotation and reuse detection, error-body shape |
| `rbac.e2e-spec.ts` | The permission matrix, warehouse scoping for staff, cross-tenant isolation, last-admin protection |
| `inventory.e2e-spec.ts` | Warehouse and product CRUD, archive-vs-delete, pagination/search/sort, replenishment thresholds, dashboard, health probes |
| `stock-flows.e2e-spec.ts` | Movements, adjustments, **concurrent oversell protection**, transfers, purchase-order receipt, sales-order allocation and fulfilment |
| `bulk-jobs.e2e-spec.ts` | The BullMQ queue end to end, including per-line error isolation |
| `rate-limit.e2e-spec.ts` | Rate limiting actually returning 429 |

Unit tests cover the money helpers (exact decimal arithmetic), pagination helpers, the RBAC matrix invariants, and the stock ledger's guard rails.

One test worth calling out:

```ts
it('never lets concurrent dispatches drive stock negative', async () => {
  // Ten simultaneous requests for 100 units each against 500 on hand.
  const results = await Promise.all(attempts);
  expect(results.filter(r => r.status === 201).length).toBe(5);   // exactly five succeed
  expect(results.filter(r => r.status === 409).length).toBe(5);
  expect((await level(warehouseA)).quantity).toBe(0);             // never negative
});
```

---

## Sample data

Two options, both included:

1. **`pnpm db:seed`** — runs `apps/api/prisma/seed.ts`. Deterministic (seeded PRNG), so every run produces identical data.
2. **`sample-data.sql`** — 534 rows across 19 tables as plain `INSERT` statements, wrapped in a transaction and idempotent:

   ```bash
   pnpm db:deploy                              # schema first
   psql "$DATABASE_URL" -f sample-data.sql     # then data
   ```

The seed does not invent stock numbers. It generates a chronological ledger of movements and derives every stock level from it, so the signed sum of a product's movements in a warehouse always equals its on-hand quantity — the same invariant the running application maintains, verified in the tests.

---

## How it works

### Multi-tenancy

Every tenant-owned row carries `organizationId`. A global `OrgContextGuard` resolves the active organisation from the `x-organization-id` header (or the user's sole membership) and attaches it to the request; every query filters on *that* value, never on anything from the request body. Cross-tenant access is therefore structurally impossible rather than merely unlikely.

### RBAC

Roles are just bundles of permissions. The matrix lives in `packages/contracts/src/permissions.ts` and is the single source of truth:

```ts
ROLE_PERMISSIONS = {
  ADMIN:   [...all],
  MANAGER: [...staff, 'warehouse:create', 'stock:adjust', 'purchase_order:receive', …],
  STAFF:   ['warehouse:read', 'stock:read', 'movement:read', 'movement:record', …],
}
```

Guards check **permissions**, not roles:

```ts
@Delete(':id')
@RequirePermissions('warehouse:delete')   // only ADMIN holds this
async remove(...) {}
```

The web app imports the same matrix to build its navigation and decide which buttons to render — so the UI can never offer an action the API would reject with a 403.

**Warehouse scoping:** `ADMIN` and `MANAGER` see every site. `STAFF` are restricted to the warehouses they are explicitly assigned to, enforced in query filters and by an `assertWarehouseAccess` check on every warehouse-targeted write.

### The stock ledger

`StockLevel` holds on-hand and reserved quantity per `(product, warehouse)` pair. `StockMovement` is an append-only ledger explaining how each level got there — rows are never updated or deleted.

Every stock change in the entire system passes through one method, `StockLedgerService.applyMovement`. Purchase receipts, dispatches, transfers, manual adjustments and queued bulk jobs all call it, so there is exactly one place that can move a number and exactly one place that writes the matching ledger row. Nothing can change stock without leaving a trace, because there is no other code path that can.

Concurrency is handled with `SELECT … FOR UPDATE`. Two pickers dispatching the last unit of a SKU at the same instant serialise on the row lock, so the second sees the first's decrement and is rejected rather than both reading "1 available".

### On hand vs. available

Sales orders separate *allocating* stock from *shipping* it:

```
DRAFT → ALLOCATED → PARTIALLY_FULFILLED → FULFILLED
```

Allocation reserves units without moving them, so two orders cannot both promise the last item on the shelf. Fulfilment converts the reservation into a real outbound movement. A manual outbound dispatch is refused if it would eat into stock another order has reserved.

### Transfers

```
DRAFT → IN_TRANSIT → COMPLETED
```

Stock leaves the source on dispatch and arrives at the destination on receipt, so goods in transit are correctly absent from both sites. A single-step transfer would overstate the destination's availability for as long as the lorry is on the road. Cancelling an in-transit transfer returns the stock to the source.

### Deleting things that have history

Warehouses and products that carry stock or movement history are **archived**, not deleted — the ledger references them, and removing the row would destroy audit history. Genuinely unused records are deleted outright. The API reports which it did, and the UI shows that message verbatim.

### Scalability

- **Background jobs** — bulk stock adjustments (up to 50 000 lines) are queued on BullMQ and applied in chunked transactions. One giant transaction would hold row locks across the catalogue for minutes; 500 short ones do not. A bad line fails that line only, and is reported per-line on the job record.
- **Caching** — the dashboard and low-stock report are cached in Redis, keyed per organisation and warehouse scope, and invalidated by tenant prefix (`SCAN` + `DEL`) on any write. A Redis outage degrades latency, not availability.
- **Pagination** — every list endpoint is paginated with a hard `pageSize` cap of 100, and sorting is restricted to an allow-list so a caller cannot turn a cheap endpoint into a full table scan on an unindexed column.
- **Indexes** — composite indexes on every tenant + filter combination the API actually queries.

### Web architecture

The dashboard is a backend-for-frontend. Both tokens live in `httpOnly` cookies and never reach client-side JavaScript; all API calls are made from the Next.js server. `proxy.ts` refreshes the access token when it is close to expiry — the only place in the request lifecycle that can both call the API and write the new cookie back.

---

## API reference

Interactive Swagger UI at **<http://localhost:4300/docs>** once the API is running.

All routes are under `/api/v1`. Send `Authorization: Bearer <accessToken>`, and `x-organization-id` when the user belongs to more than one organisation.

<details>
<summary><strong>All 63 endpoints</strong></summary>

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/auth/sign-up` | public |
| POST | `/auth/sign-in` | public |
| POST | `/auth/refresh` | public |
| POST | `/auth/sign-out` | public |
| GET | `/auth/me` | authenticated |
| POST | `/auth/sign-out-all` | authenticated |
| GET | `/organization` | `org:read` |
| PATCH | `/organization` | `org:update` |
| GET | `/organization/members` | `member:read` |
| POST | `/organization/members` | `member:invite` |
| PATCH | `/organization/members/:id` | `member:manage` |
| DELETE | `/organization/members/:id` | `member:manage` |
| GET | `/warehouses` | `warehouse:read` |
| GET | `/warehouses/:id` | `warehouse:read` |
| POST | `/warehouses` | `warehouse:create` |
| PATCH | `/warehouses/:id` | `warehouse:update` |
| DELETE | `/warehouses/:id` | `warehouse:delete` |
| PUT | `/warehouses/:id/members` | `warehouse:assign` |
| GET/POST/PATCH/DELETE | `/categories…` | `category:read` / `category:manage` |
| GET/POST/PATCH/DELETE | `/suppliers…` | `supplier:read` / `supplier:manage` |
| GET | `/products` | `product:read` |
| GET | `/products/:id` | `product:read` |
| POST | `/products` | `product:create` |
| PATCH | `/products/:id` | `product:update` |
| DELETE | `/products/:id` | `product:delete` |
| GET | `/stock/levels` | `stock:read` |
| GET | `/stock/movements` | `movement:read` |
| POST | `/stock/movements` | `movement:record` |
| POST | `/stock/adjustments` | `stock:adjust` |
| PUT | `/stock/replenishment-rules` | `replenishment:manage` |
| GET | `/stock/low-stock` | `replenishment:read` |
| GET | `/transfers` | `stock:read` |
| GET | `/transfers/:id` | `stock:read` |
| POST | `/transfers` | `stock:transfer` |
| POST | `/transfers/:id/dispatch` | `stock:transfer` |
| POST | `/transfers/:id/receive` | `stock:transfer` |
| POST | `/transfers/:id/cancel` | `stock:transfer` |
| GET | `/purchase-orders` | `purchase_order:read` |
| GET | `/purchase-orders/:id` | `purchase_order:read` |
| POST | `/purchase-orders` | `purchase_order:manage` |
| PATCH | `/purchase-orders/:id` | `purchase_order:manage` |
| POST | `/purchase-orders/:id/submit` | `purchase_order:manage` |
| POST | `/purchase-orders/:id/receive` | `purchase_order:receive` |
| POST | `/purchase-orders/:id/cancel` | `purchase_order:manage` |
| GET | `/sales-orders` | `sales_order:read` |
| GET | `/sales-orders/:id` | `sales_order:read` |
| POST | `/sales-orders` | `sales_order:manage` |
| PATCH | `/sales-orders/:id` | `sales_order:manage` |
| POST | `/sales-orders/:id/allocate` | `sales_order:manage` |
| POST | `/sales-orders/:id/fulfill` | `sales_order:fulfill` |
| POST | `/sales-orders/:id/cancel` | `sales_order:manage` |
| GET | `/reports/dashboard` | `report:read` |
| POST | `/jobs/bulk-stock-adjustments` | `job:create` + `stock:adjust` |
| GET | `/jobs` | `job:read` |
| GET | `/jobs/:id` | `job:read` |
| GET | `/health` | public |
| GET | `/health/ready` | public |

</details>

### Error shape

Every failure returns the same body, so an integrator only ever parses one shape:

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

The `requestId` is echoed in the `x-request-id` response header and appears in the server logs, so a user-reported failure can be traced to a single log line.

### Quick API tour

```bash
BASE=http://localhost:4300/api/v1

TOKEN=$(curl -s -X POST $BASE/auth/sign-in \
  -H 'Content-Type: application/json' \
  -d '{"email":"manager@praella-wms.dev","password":"Praella@2026"}' \
  | jq -r .tokens.accessToken)

curl -s $BASE/reports/dashboard   -H "Authorization: Bearer $TOKEN" | jq
curl -s "$BASE/products?search=aurora&pageSize=5" -H "Authorization: Bearer $TOKEN" | jq
curl -s $BASE/stock/low-stock     -H "Authorization: Bearer $TOKEN" | jq
```

---

## Deployment

Not currently hosted. Both apps ship with production Dockerfiles and run anywhere that can run a container.

### Docker

```bash
docker build -f apps/api/Dockerfile -t wms-api .
docker build -f apps/web/Dockerfile -t wms-web .

docker run -p 4300:4300 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/wms" \
  -e REDIS_HOST=redis -e REDIS_PORT=6379 \
  -e JWT_ACCESS_SECRET="<32+ char secret>" \
  -e JWT_REFRESH_SECRET="<different 32+ char secret>" \
  -e CORS_ORIGINS="https://your-dashboard.example" \
  wms-api

docker run -p 3300:3300 -e API_BASE_URL="https://your-api.example/api/v1" wms-web
```

Run migrations once against the target database before first boot:

```bash
DATABASE_URL="postgresql://…" pnpm --filter @wms/api prisma:deploy
```

### Platform notes

- **API** — Railway, Render, Fly.io or any container host. Needs PostgreSQL 16 and (optionally) Redis 7. Point the platform's health check at `/health`.
- **Web** — Vercel works directly from `apps/web`; set `API_BASE_URL` and no other configuration is required.
- **Database** — any managed Postgres. Prisma 7 uses a `pg` driver adapter, so a connection pooler such as PgBouncer works without special configuration.

### Production checklist

- [ ] Replace both JWT secrets with independent random values ≥ 32 characters
- [ ] Set `NODE_ENV=production` (cookies become `Secure`)
- [ ] Set `CORS_ORIGINS` to the real dashboard origin
- [ ] Terminate TLS in front of both services
- [ ] Run `prisma migrate deploy` as a release step, never `migrate dev`

---

## Project summary

### Approach

I read the brief as a request for an inventory system that could actually be trusted with stock, rather than a CRUD app with an `inventory` table. Three decisions followed from that and shaped everything else:

**1. Stock is a ledger, not a column.** The obvious implementation is `product.quantity`, incremented and decremented in place. That number is unauditable the moment anyone disputes it. Instead, `StockLevel` holds the current quantity per `(product, warehouse)` pair and `StockMovement` is an append-only ledger explaining every change. Crucially, *every* stock change in the system routes through one method — so it is impossible to move stock without leaving a trace, because no other code path exists. The seed data is built the same way, and the tests assert the ledger reconciles.

**2. Permissions, not roles, at the boundary.** The brief asks for "fine-grained permissions (e.g. only Admins can delete warehouses)". Scattering `if (role === 'ADMIN')` across controllers works until the fourth role arrives. Instead there is one `resource:action` permission matrix in the shared package, guards check permissions, and roles are just bundles. Adding a role later touches one file. The web app imports the same matrix to build its navigation, so the UI and API cannot disagree.

**3. One definition of every contract.** `packages/contracts` holds the Zod schemas, the permission matrix and the response types. The API generates its DTOs and its OpenAPI document from them; the web app validates its forms and types its responses with them. There is no second copy of a validation rule to drift.

Beyond that: multi-tenancy is enforced by an org-context guard rather than by remembering to filter, money is `Decimal` in Postgres and a string on the wire so nothing is lost to floating point, and concurrency is handled with row locks — with a test that fires ten simultaneous dispatches at 500 units of stock and asserts exactly five succeed.

I built the API first and drove it entirely from the command line until every flow was correct, then wrote the tests, then the dashboard. The UI is a Next.js backend-for-frontend: tokens live in `httpOnly` cookies and never touch client-side JavaScript.

### What I liked

The **shared contracts package** paid for itself repeatedly. Changing a validation rule updates the API, the OpenAPI document and the frontend form in one edit, and a mismatch is a compile error rather than a bug report.

The **single-choke-point ledger** turned out to be the highest-leverage decision in the project. Once `applyMovement` existed, purchase receipts, transfers, sales fulfilment and bulk jobs were each about twenty lines, and all of them inherited oversell protection, reservation checks and audit history for free.

**Modelling reservations separately from on-hand stock** was more interesting than expected. It is the difference between "500 in the warehouse" and "500 in the warehouse, 450 already promised", and it makes the difference between a system that can and cannot be trusted to accept an order.

Prisma 7's move to driver adapters is a genuine improvement — the connection pool is explicit and tunable instead of hidden inside a Rust binary.

### What I disliked

**Prisma cannot compare two columns in a `where` clause.** "Every row where `quantity <= reorderPoint`" is the central query of the entire replenishment feature and it cannot be expressed. I narrow the query to rows that have a threshold set and finish the comparison in JavaScript. It is correct and the scanned set is small, but at real scale this wants a raw SQL query or a generated column, and I have noted it below.

**Next.js 16's server/client boundary rules cost me time.** A `'use server'` file may only export async functions, so exporting an `IDLE` constant alongside the actions breaks the module — with an error pointing at the file's last line rather than the offending export. Separately, passing a render-prop as `children` from a Server Component to a Client Component fails at runtime, not at compile time. Both were quick to fix once diagnosed; neither was quick to diagnose.

**The two-decimal-place money rule is unfashionably strict** and I stand by it, but it does mean an API client sending `unitPrice: 1.005` gets a 422 rather than silent rounding. That is the right trade for inventory valuation, but it is the kind of thing that generates support tickets.

### Challenges

**Concurrent stock updates.** Read-modify-write on a stock level is a textbook race: two requests read "1 available", both write "0", and one unit is sold twice. I settled on `SELECT … FOR UPDATE` inside the transaction — simple, obviously correct, and easy to explain. The alternative (a conditional `UPDATE … WHERE quantity >= n`) is one query cheaper, but expressing "and don't eat into reserved stock" that way gets unreadable fast. The test that fires ten concurrent dispatches at 500 units exists precisely because this is easy to get subtly wrong.

**Attributing a transfer to a warehouse.** My first schema gave `StockMovement` a `sourceWarehouseId`/`destinationWarehouseId` pair. It looks natural until you ask "which site's balance did this row change?" — for a transfer, both columns are populated and the answer is ambiguous. I caught it while writing a reconciliation query against the seed data that reported six mismatches; the data was fine, my query could not be written correctly. I replaced the pair with a required `warehouseId` (the site whose balance moved) plus an optional `counterpartWarehouseId`, and reconstruct the "from → to" reading in the view layer.

**Health probes and API versioning.** `/health` was answering on `/v1/health`, because URI versioning applies to routes even when they are excluded from the global prefix. An integration test caught it. Probes now use `VERSION_NEUTRAL`, so a load balancer does not need reconfiguring the day the API goes to v2.

**A partial `dist` that ran but crashed.** `nest build` deletes the output directory while TypeScript's `incremental` build info still claims those files are current, so the build silently emitted a partial `dist` that failed at runtime with a missing-module error. Turning off `incremental` fixed it; the note is in `tsconfig.json` so nobody turns it back on.

**A "flaky" test that was really cross-environment contamination.** The bulk-job spec failed roughly one run in four. It was not timing: the test suite and a running dev server shared one BullMQ queue in Redis, so whichever worker happened to claim a job might be connected to the *other* one's database, and would fail to find the job row. The fix was to namespace queue keys with a `QUEUE_PREFIX` — which the application wanted anyway — and give the suite its own. Verified by running the suite five times with the dev server deliberately left running.

**Rate limiting versus the test suite.** The auth endpoints carry a deliberately tight limit that a spec making dozens of legitimate sign-ins trips immediately. Overriding the guard does not work, because `APP_GUARD` instantiates it directly rather than resolving the class token. The fix was to make the limit environment-driven — which it should have been anyway — and have the test setup raise it for every spec except the one that exists to prove rate limiting works.

### Time spent

**Roughly 9–10 hours**, broadly:

| | |
| --- | --- |
| Schema design, migrations, seed | ~2h |
| Auth, RBAC, multi-tenancy | ~1.5h |
| Inventory, stock ledger, transfers, orders | ~2.5h |
| Queues, caching, reports | ~1h |
| Tests (124) | ~1.5h |
| Next.js dashboard | ~2h |
| README, Dockerfiles, sample data | ~1h |

### Pending items

Things I would do next, in priority order:

1. **Push the low-stock comparison into SQL.** Currently the threshold comparison happens in JavaScript because Prisma cannot compare two columns. A raw query or a generated `is_below_threshold` column would make it index-friendly at scale.
2. **Create/edit forms for orders and transfers in the UI.** The API supports the full lifecycle and the dashboard drives every *transition* (submit, receive, allocate, fulfil, dispatch, cancel), but multi-line order composition is currently API-only. It is a form-builder problem, not a domain problem.
3. **Real invitation emails.** Adding a member currently sets a temporary password directly, so the demo is self-contained. Production wants a signed invite link and a proper password-reset flow.
4. **CSV import/export.** The bulk-job infrastructure exists and takes JSON lines; a CSV parser in front of it is a small, high-value addition for a warehouse team.
5. **Frontend component tests.** The UI is covered indirectly by the API integration suite and was verified manually in a real browser across all three roles, but React Testing Library specs for the dialogs and permission-gated rendering would be worth adding.
6. **Observability.** Structured JSON logging, OpenTelemetry traces and Prometheus metrics. The correlation-id plumbing is already in place to hang them off.
7. **Optimistic concurrency on order edits.** Stock is safe under concurrency; two managers editing the same purchase order simultaneously is currently last-write-wins.

---

## Notes for the reviewer

- The fastest way to see the RBAC working is to sign in as `staff@praella-wms.dev` and compare the dashboard with `admin@praella-wms.dev`.
- `pnpm test:e2e` needs Docker running; it creates and migrates its own `wms_test` database and never touches your development data.
- Swagger UI at `/docs` has "Try it out" enabled — sign in via `/auth/sign-in`, click **Authorize**, paste the access token, and every endpoint is callable from the browser.
