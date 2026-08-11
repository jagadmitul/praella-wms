import { z } from 'zod';
import {
  bulkJobStatusSchema,
  bulkJobTypeSchema,
  movementReferenceTypeSchema,
  movementTypeSchema,
  purchaseOrderStatusSchema,
  roleSchema,
  salesOrderStatusSchema,
  stockTransferStatusSchema,
} from './enums';
import type { ApiErrorBody, BulkResult } from './common';
import type {
  BulkJobView,
  CategoryView,
  DashboardSummaryView,
  InvitationView,
  LowStockItemView,
  MemberView,
  OrganizationView,
  ProductView,
  PurchaseOrderView,
  SalesOrderView,
  StockLevelView,
  StockMovementView,
  StockTransferView,
  SupplierView,
  WarehouseView,
} from './views';

/**
 * Zod schemas describing what the API *returns*.
 *
 * `views.ts` defines these shapes as TypeScript interfaces, which the
 * application code uses. Those interfaces are invisible at runtime, so the
 * OpenAPI document had no response schemas at all — every endpoint documented
 * its inputs precisely and its outputs not at all, which is a poor deal for an
 * API meant to be integrated against.
 *
 * These schemas close that gap. Each one is annotated `satisfies z.ZodType<…>`
 * against its interface, so if the two ever diverge the build fails rather than
 * the documentation quietly going stale.
 */

const idRef = z.object({ id: z.string(), name: z.string() });
const warehouseRef = z.object({ id: z.string(), name: z.string(), code: z.string() });
const actorRef = z.object({ id: z.string(), fullName: z.string() });

export const organizationViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
}) satisfies z.ZodType<OrganizationView>;

export const memberViewSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  joinedAt: z.string(),
  warehouses: z.array(warehouseRef),
}) satisfies z.ZodType<MemberView>;

export const warehouseViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  country: z.string().nullable(),
  postalCode: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stats: z.object({
    productCount: z.number(),
    totalUnits: z.number(),
    lowStockCount: z.number(),
  }),
}) satisfies z.ZodType<WarehouseView>;

export const categoryViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  productCount: z.number(),
}) satisfies z.ZodType<CategoryView>;

export const supplierViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  contactName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  productCount: z.number(),
}) satisfies z.ZodType<SupplierView>;

export const productViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  description: z.string().nullable(),
  unit: z.string(),
  /** Decimal serialised as a string so no precision is lost crossing JSON. */
  unitPrice: z.string(),
  defaultReorderPoint: z.number(),
  defaultReorderQuantity: z.number(),
  isActive: z.boolean(),
  category: idRef.nullable(),
  supplier: idRef.nullable(),
  totalQuantity: z.number(),
  totalReserved: z.number(),
  totalAvailable: z.number(),
  isBelowThreshold: z.boolean(),
  stockByWarehouse: z.array(
    z.object({
      warehouseId: z.string(),
      warehouseName: z.string(),
      warehouseCode: z.string(),
      quantity: z.number(),
      reservedQuantity: z.number(),
      availableQuantity: z.number(),
      reorderPoint: z.number(),
      reorderQuantity: z.number(),
      isBelowThreshold: z.boolean(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<ProductView>;

export const stockLevelViewSchema = z.object({
  id: z.string(),
  quantity: z.number(),
  reservedQuantity: z.number(),
  availableQuantity: z.number(),
  reorderPoint: z.number(),
  reorderQuantity: z.number(),
  isBelowThreshold: z.boolean(),
  product: z.object({
    id: z.string(),
    name: z.string(),
    sku: z.string(),
    unit: z.string(),
    unitPrice: z.string(),
  }),
  warehouse: warehouseRef,
  updatedAt: z.string(),
}) satisfies z.ZodType<StockLevelView>;

export const stockMovementViewSchema = z.object({
  id: z.string(),
  type: movementTypeSchema,
  quantity: z.number(),
  balanceAfter: z.number(),
  unitCost: z.string().nullable(),
  note: z.string().nullable(),
  referenceType: movementReferenceTypeSchema,
  referenceId: z.string().nullable(),
  referenceCode: z.string().nullable(),
  product: z.object({ id: z.string(), name: z.string(), sku: z.string() }),
  sourceWarehouse: warehouseRef.nullable(),
  destinationWarehouse: warehouseRef.nullable(),
  createdBy: actorRef.nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<StockMovementView>;

export const stockTransferViewSchema = z.object({
  id: z.string(),
  code: z.string(),
  version: z.number(),
  status: stockTransferStatusSchema,
  notes: z.string().nullable(),
  sourceWarehouse: warehouseRef,
  destinationWarehouse: warehouseRef,
  items: z.array(
    z.object({
      id: z.string(),
      quantity: z.number(),
      product: z.object({ id: z.string(), name: z.string(), sku: z.string() }),
    }),
  ),
  createdBy: actorRef.nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
}) satisfies z.ZodType<StockTransferView>;

const orderLineProduct = z.object({
  id: z.string(),
  name: z.string(),
  sku: z.string(),
  unit: z.string(),
});

export const purchaseOrderViewSchema = z.object({
  id: z.string(),
  code: z.string(),
  version: z.number(),
  status: purchaseOrderStatusSchema,
  notes: z.string().nullable(),
  totalAmount: z.string(),
  expectedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  supplier: idRef,
  warehouse: warehouseRef,
  items: z.array(
    z.object({
      id: z.string(),
      quantity: z.number(),
      receivedQuantity: z.number(),
      outstandingQuantity: z.number(),
      unitCost: z.string(),
      lineTotal: z.string(),
      product: orderLineProduct,
    }),
  ),
  createdBy: actorRef.nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<PurchaseOrderView>;

export const salesOrderViewSchema = z.object({
  id: z.string(),
  code: z.string(),
  version: z.number(),
  status: salesOrderStatusSchema,
  notes: z.string().nullable(),
  totalAmount: z.string(),
  customerName: z.string(),
  customerEmail: z.string().nullable(),
  fulfilledAt: z.string().nullable(),
  warehouse: warehouseRef,
  items: z.array(
    z.object({
      id: z.string(),
      quantity: z.number(),
      fulfilledQuantity: z.number(),
      outstandingQuantity: z.number(),
      unitPrice: z.string(),
      lineTotal: z.string(),
      product: orderLineProduct,
    }),
  ),
  createdBy: actorRef.nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<SalesOrderView>;

export const bulkJobViewSchema = z.object({
  id: z.string(),
  type: bulkJobTypeSchema,
  status: bulkJobStatusSchema,
  totalLines: z.number(),
  processedLines: z.number(),
  failedLines: z.number(),
  errors: z.array(z.object({ line: z.number(), message: z.string() })),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
}) satisfies z.ZodType<BulkJobView>;

export const lowStockItemViewSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  sku: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  warehouseCode: z.string(),
  quantity: z.number(),
  reorderPoint: z.number(),
  shortfall: z.number(),
  suggestedOrderQuantity: z.number(),
  supplier: idRef.nullable(),
}) satisfies z.ZodType<LowStockItemView>;

export const dashboardSummaryViewSchema = z.object({
  warehouseCount: z.number(),
  productCount: z.number(),
  totalUnits: z.number(),
  inventoryValue: z.string(),
  lowStockCount: z.number(),
  openPurchaseOrders: z.number(),
  openSalesOrders: z.number(),
  movementsLast7Days: z.number(),
  recentMovements: z.array(stockMovementViewSchema),
  topLowStock: z.array(lowStockItemViewSchema),
  movementTrend: z.array(
    z.object({ date: z.string(), inbound: z.number(), outbound: z.number() }),
  ),
}) satisfies z.ZodType<DashboardSummaryView>;

export const invitationViewSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
  invitedBy: actorRef.nullable(),
  warehouses: z.array(warehouseRef),
  inviteUrl: z.string().optional(),
}) satisfies z.ZodType<InvitationView>;

export const bulkResultSchema = z.object({
  requested: z.number(),
  succeeded: z.number(),
  failed: z.number(),
  results: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      ok: z.boolean(),
      message: z.string().optional(),
    }),
  ),
}) satisfies z.ZodType<BulkResult>;

/** Outcome of a delete that may archive instead of removing. */
export const deletionResultSchema = z.object({
  deleted: z.boolean(),
  archived: z.boolean(),
  message: z.string(),
});

/** `{ assigned: n }`, returned when warehouse members are replaced. */
export const assignmentResultSchema = z.object({ assigned: z.number() });

/** `{ email }`, returned when an invitation is accepted. */
export const acceptedInvitationSchema = z.object({ email: z.string() });

export const liveHealthSchema = z.object({
  status: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});

/**
 * Wraps an item schema in the standard `{ items, meta }` envelope used by every
 * list endpoint.
 *
 * @param itemSchema - Schema for one row.
 * @returns The paginated response schema.
 */
export function paginatedResponseSchema<TSchema extends z.ZodType>(
  itemSchema: TSchema,
) {
  return z.object({
    items: z.array(itemSchema),
    meta: z.object({
      page: z.number(),
      pageSize: z.number(),
      totalItems: z.number(),
      totalPages: z.number(),
      hasNextPage: z.boolean(),
      hasPreviousPage: z.boolean(),
    }),
  });
}

/**
 * The one error body every failure returns, mirrored as a schema so the OpenAPI
 * document can show it rather than merely describing it in prose.
 */
export const apiErrorBodySchema = z.object({
  statusCode: z.number().meta({ example: 422 }),
  error: z.string().meta({ example: 'Unprocessable Entity' }),
  message: z.string().meta({ example: 'Validation failed' }),
  details: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional()
    .meta({ description: 'Field-level validation issues, present only on 422.' }),
  path: z.string().meta({ example: '/api/v1/products' }),
  timestamp: z.string().meta({ example: '2026-08-11T10:34:39.907Z' }),
  requestId: z.string().meta({ example: '5d82f167-475e-4e86-826f-5af46b1c0f21' }),
}) satisfies z.ZodType<ApiErrorBody>;
