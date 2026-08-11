import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  acceptedInvitationSchema,
  apiErrorBodySchema,
  assignmentResultSchema,
  authSessionSchema,
  authTokensSchema,
  bulkJobViewSchema,
  bulkResultSchema,
  categoryViewSchema,
  currentSessionSchema,
  dashboardSummaryViewSchema,
  deletionResultSchema,
  invitationPreviewSchema,
  invitationViewSchema,
  liveHealthSchema,
  lowStockItemViewSchema,
  memberViewSchema,
  organizationViewSchema,
  paginatedResponseSchema,
  productViewSchema,
  purchaseOrderViewSchema,
  salesOrderViewSchema,
  stockLevelViewSchema,
  stockMovementViewSchema,
  stockTransferViewSchema,
  supplierViewSchema,
  warehouseViewSchema,
} from '@wms/contracts';

/**
 * Response DTOs for the OpenAPI document.
 *
 * Request bodies were always documented — they are `createZodDto` classes, so
 * nestjs-zod derives their schemas automatically. Responses were not: the view
 * models are TypeScript interfaces, which do not exist at runtime, so every
 * endpoint described its inputs precisely and its outputs not at all.
 *
 * These classes close that gap from the same Zod schemas the contracts package
 * exports, so `/docs` now shows the exact shape of every response — and an
 * integrator can generate a typed client from the document alone.
 */

/* ------------------------------- Auth ------------------------------------ */
export class AuthSessionResponse extends createZodDto(authSessionSchema) {}
export class AuthTokensResponse extends createZodDto(authTokensSchema) {}
export class CurrentSessionResponse extends createZodDto(
  currentSessionSchema,
) {}

/* --------------------------- Organisation -------------------------------- */
export class OrganizationResponse extends createZodDto(
  organizationViewSchema,
) {}
export class MemberResponse extends createZodDto(memberViewSchema) {}
export class MemberListResponse extends createZodDto(
  paginatedResponseSchema(memberViewSchema),
) {}

/* ---------------------------- Invitations -------------------------------- */
export class InvitationResponse extends createZodDto(invitationViewSchema) {}
export class InvitationListResponse extends createZodDto(
  z.array(invitationViewSchema),
) {}
export class InvitationPreviewResponse extends createZodDto(
  invitationPreviewSchema,
) {}
export class AcceptedInvitationResponse extends createZodDto(
  acceptedInvitationSchema,
) {}

/* ----------------------------- Warehouses -------------------------------- */
export class WarehouseResponse extends createZodDto(warehouseViewSchema) {}
export class WarehouseListResponse extends createZodDto(
  paginatedResponseSchema(warehouseViewSchema),
) {}
export class AssignmentResultResponse extends createZodDto(
  assignmentResultSchema,
) {}

/* ------------------------------ Catalogue -------------------------------- */
export class CategoryResponse extends createZodDto(categoryViewSchema) {}
export class CategoryListResponse extends createZodDto(
  paginatedResponseSchema(categoryViewSchema),
) {}
export class SupplierResponse extends createZodDto(supplierViewSchema) {}
export class SupplierListResponse extends createZodDto(
  paginatedResponseSchema(supplierViewSchema),
) {}

/* ------------------------------- Products -------------------------------- */
export class ProductResponse extends createZodDto(productViewSchema) {}
export class ProductListResponse extends createZodDto(
  paginatedResponseSchema(productViewSchema),
) {}

/* -------------------------------- Stock ---------------------------------- */
export class StockLevelResponse extends createZodDto(stockLevelViewSchema) {}
export class StockLevelListResponse extends createZodDto(
  paginatedResponseSchema(stockLevelViewSchema),
) {}
export class StockMovementListResponse extends createZodDto(
  paginatedResponseSchema(stockMovementViewSchema),
) {}
export class LowStockListResponse extends createZodDto(
  z.array(lowStockItemViewSchema),
) {}

/* ------------------------------ Transfers -------------------------------- */
export class StockTransferResponse extends createZodDto(
  stockTransferViewSchema,
) {}
export class StockTransferListResponse extends createZodDto(
  paginatedResponseSchema(stockTransferViewSchema),
) {}

/* -------------------------------- Orders --------------------------------- */
export class PurchaseOrderResponse extends createZodDto(
  purchaseOrderViewSchema,
) {}
export class PurchaseOrderListResponse extends createZodDto(
  paginatedResponseSchema(purchaseOrderViewSchema),
) {}
export class SalesOrderResponse extends createZodDto(salesOrderViewSchema) {}
export class SalesOrderListResponse extends createZodDto(
  paginatedResponseSchema(salesOrderViewSchema),
) {}

/* --------------------------- Reports and jobs ---------------------------- */
export class DashboardResponse extends createZodDto(
  dashboardSummaryViewSchema,
) {}
export class BulkJobResponse extends createZodDto(bulkJobViewSchema) {}
export class BulkJobListResponse extends createZodDto(
  paginatedResponseSchema(bulkJobViewSchema),
) {}

/* -------------------------------- Shared --------------------------------- */
export class BulkResultResponse extends createZodDto(bulkResultSchema) {}
export class DeletionResultResponse extends createZodDto(
  deletionResultSchema,
) {}
export class LiveHealthResponse extends createZodDto(liveHealthSchema) {}

/* ------------------------------- Errors ---------------------------------- */
/**
 * The single error body shape. Attached to every documented failure response so
 * an integrator can code against one parser rather than guessing per endpoint.
 */
export class ApiErrorResponse extends createZodDto(apiErrorBodySchema) {}
