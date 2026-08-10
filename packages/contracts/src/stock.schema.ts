import { z } from 'zod';
import { movementTypeSchema, stockTransferStatusSchema } from './enums';
import {
  idSchema,
  moneySchema,
  noteSchema,
  paginationQuerySchema,
  positiveQuantitySchema,
  quantitySchema,
} from './common';

/* -------------------------------------------------------------------------- */
/*                              Stock adjustments                             */
/* -------------------------------------------------------------------------- */

/**
 * A manual correction of a stock level, e.g. after a physical count. Requires
 * `stock:adjust`, which STAFF deliberately do not hold — they record movements
 * instead, which leaves an auditable in/out trail rather than an opaque delta.
 */
export const adjustStockSchema = z.object({
  productId: idSchema,
  warehouseId: idSchema,
  /** Signed delta applied to the current quantity. Never zero. */
  delta: z
    .number()
    .int('Adjustment must be a whole number')
    .refine((value) => value !== 0, { message: 'Adjustment cannot be zero' })
    .refine((value) => Math.abs(value) <= 1_000_000, {
      message: 'Adjustment is too large — use a bulk job instead',
    }),
  reason: z.string().trim().min(3, 'Give a reason for the adjustment').max(300),
});
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

/**
 * Records a physical goods movement into or out of a warehouse. This is the one
 * write STAFF are permitted to make.
 */
export const recordMovementSchema = z.object({
  productId: idSchema,
  warehouseId: idSchema,
  type: z.enum(['INBOUND', 'OUTBOUND']),
  quantity: positiveQuantitySchema,
  unitCost: moneySchema.optional(),
  note: noteSchema,
});
export type RecordMovementInput = z.infer<typeof recordMovementSchema>;

export const movementQuerySchema = paginationQuerySchema.extend({
  productId: idSchema.optional(),
  warehouseId: idSchema.optional(),
  type: movementTypeSchema.optional(),
  /** ISO-8601 date-time lower bound, inclusive. */
  from: z.string().datetime({ offset: true }).optional(),
  /** ISO-8601 date-time upper bound, inclusive. */
  to: z.string().datetime({ offset: true }).optional(),
});
export type MovementQuery = z.infer<typeof movementQuerySchema>;

/* -------------------------------------------------------------------------- */
/*                             Replenishment rules                            */
/* -------------------------------------------------------------------------- */

/**
 * Minimum stock threshold for one product in one warehouse. Thresholds live on
 * the stock level rather than the product because the same SKU can justify very
 * different safety stock in a hub versus a spoke warehouse.
 */
export const setReplenishmentRuleSchema = z.object({
  productId: idSchema,
  warehouseId: idSchema,
  reorderPoint: quantitySchema,
  reorderQuantity: quantitySchema,
});
export type SetReplenishmentRuleInput = z.infer<typeof setReplenishmentRuleSchema>;

export const stockLevelQuerySchema = paginationQuerySchema.extend({
  warehouseId: idSchema.optional(),
  productId: idSchema.optional(),
  categoryId: idSchema.optional(),
  belowThreshold: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
});
export type StockLevelQuery = z.infer<typeof stockLevelQuerySchema>;

/* -------------------------------------------------------------------------- */
/*                                  Transfers                                 */
/* -------------------------------------------------------------------------- */

export const transferLineSchema = z.object({
  productId: idSchema,
  quantity: positiveQuantitySchema,
});

export const createTransferSchema = z
  .object({
    sourceWarehouseId: idSchema,
    destinationWarehouseId: idSchema,
    notes: noteSchema,
    items: z.array(transferLineSchema).min(1, 'Add at least one product'),
  })
  .refine((value) => value.sourceWarehouseId !== value.destinationWarehouseId, {
    message: 'Source and destination warehouses must be different',
    path: ['destinationWarehouseId'],
  })
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.productId)).size === value.items.length,
    { message: 'Each product may only appear once', path: ['items'] },
  );
export type CreateTransferInput = z.infer<typeof createTransferSchema>;

export const transferQuerySchema = paginationQuerySchema.extend({
  status: stockTransferStatusSchema.optional(),
  sourceWarehouseId: idSchema.optional(),
  destinationWarehouseId: idSchema.optional(),
});
export type TransferQuery = z.infer<typeof transferQuerySchema>;

/* -------------------------------------------------------------------------- */
/*                                 Bulk jobs                                  */
/* -------------------------------------------------------------------------- */

export const bulkStockAdjustmentLineSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  warehouseCode: z.string().trim().min(1).max(40),
  delta: z.number().int(),
  reason: z.string().trim().max(300).optional(),
});

/**
 * Bulk stock updates are queued rather than executed inline: a 20 000-line
 * correction should not hold an HTTP connection open, and the queue gives us
 * retries plus per-row error reporting.
 */
export const createBulkStockJobSchema = z.object({
  lines: z
    .array(bulkStockAdjustmentLineSchema)
    .min(1, 'Provide at least one line')
    .max(50_000, 'Split jobs larger than 50 000 lines'),
});
export type CreateBulkStockJobInput = z.infer<typeof createBulkStockJobSchema>;
