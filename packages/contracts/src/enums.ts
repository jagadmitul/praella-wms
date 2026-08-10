import { z } from 'zod';

/**
 * Organisation-level role assigned to a membership. Mirrors the `Role` enum in
 * the Prisma schema — the two must always be kept in sync.
 */
export const roleSchema = z.enum(['ADMIN', 'MANAGER', 'STAFF']);
export type Role = z.infer<typeof roleSchema>;

/**
 * Kind of stock movement recorded in the immutable stock ledger.
 *
 * `TRANSFER_OUT` / `TRANSFER_IN` are always written as a pair inside a single
 * transaction so that the ledger nets to zero for a warehouse-to-warehouse move.
 */
export const movementTypeSchema = z.enum([
  'INBOUND',
  'OUTBOUND',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
]);
export type MovementType = z.infer<typeof movementTypeSchema>;

/** Business document that caused a stock movement. */
export const movementReferenceTypeSchema = z.enum([
  'PURCHASE_ORDER',
  'SALES_ORDER',
  'STOCK_TRANSFER',
  'MANUAL_ADJUSTMENT',
  'BULK_JOB',
]);
export type MovementReferenceType = z.infer<typeof movementReferenceTypeSchema>;

/** Lifecycle of an inbound purchase order. */
export const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
]);
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

/** Lifecycle of an outbound sales / dispatch order. */
export const salesOrderStatusSchema = z.enum([
  'DRAFT',
  'ALLOCATED',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED',
]);
export type SalesOrderStatus = z.infer<typeof salesOrderStatusSchema>;

/** Lifecycle of a warehouse-to-warehouse stock transfer. */
export const stockTransferStatusSchema = z.enum([
  'DRAFT',
  'IN_TRANSIT',
  'COMPLETED',
  'CANCELLED',
]);
export type StockTransferStatus = z.infer<typeof stockTransferStatusSchema>;

/** Background job types processed by the BullMQ workers. */
export const bulkJobTypeSchema = z.enum([
  'BULK_STOCK_ADJUSTMENT',
  'BULK_PRODUCT_IMPORT',
]);
export type BulkJobType = z.infer<typeof bulkJobTypeSchema>;

/** Lifecycle of a queued background job. */
export const bulkJobStatusSchema = z.enum([
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
]);
export type BulkJobStatus = z.infer<typeof bulkJobStatusSchema>;
