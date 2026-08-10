import { z } from 'zod';
import { purchaseOrderStatusSchema, salesOrderStatusSchema } from './enums';
import {
  idSchema,
  moneySchema,
  noteSchema,
  paginationQuerySchema,
  positiveQuantitySchema,
  shortTextSchema,
} from './common';

/* -------------------------------------------------------------------------- */
/*                               Purchase orders                              */
/* -------------------------------------------------------------------------- */

export const purchaseOrderLineSchema = z.object({
  productId: idSchema,
  quantity: positiveQuantitySchema,
  unitCost: moneySchema,
});

export const createPurchaseOrderSchema = z
  .object({
    supplierId: idSchema,
    warehouseId: idSchema,
    expectedAt: z.string().datetime({ offset: true }).optional(),
    notes: noteSchema,
    items: z.array(purchaseOrderLineSchema).min(1, 'Add at least one line item'),
  })
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.productId)).size === value.items.length,
    { message: 'Each product may only appear once', path: ['items'] },
  );
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

export const updatePurchaseOrderSchema = z.object({
  expectedAt: z.string().datetime({ offset: true }).optional(),
  notes: noteSchema,
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

/**
 * Receiving is partial-capable: each call names the lines and quantities that
 * physically arrived. Omitting `items` receives every outstanding line in full,
 * which is the common "the whole shipment turned up" case.
 */
export const receivePurchaseOrderSchema = z.object({
  items: z
    .array(
      z.object({
        purchaseOrderItemId: idSchema,
        quantity: positiveQuantitySchema,
      }),
    )
    .optional(),
  note: noteSchema,
});
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;

export const purchaseOrderQuerySchema = paginationQuerySchema.extend({
  status: purchaseOrderStatusSchema.optional(),
  supplierId: idSchema.optional(),
  warehouseId: idSchema.optional(),
});
export type PurchaseOrderQuery = z.infer<typeof purchaseOrderQuerySchema>;

/* -------------------------------------------------------------------------- */
/*                                Sales orders                                */
/* -------------------------------------------------------------------------- */

export const salesOrderLineSchema = z.object({
  productId: idSchema,
  quantity: positiveQuantitySchema,
  unitPrice: moneySchema,
});

export const createSalesOrderSchema = z
  .object({
    warehouseId: idSchema,
    customerName: shortTextSchema,
    customerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
        message: 'Enter a valid email address',
      })
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    notes: noteSchema,
    items: z.array(salesOrderLineSchema).min(1, 'Add at least one line item'),
  })
  .refine(
    (value) =>
      new Set(value.items.map((item) => item.productId)).size === value.items.length,
    { message: 'Each product may only appear once', path: ['items'] },
  );
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderSchema>;

export const updateSalesOrderSchema = z.object({
  customerName: shortTextSchema.optional(),
  notes: noteSchema,
});
export type UpdateSalesOrderInput = z.infer<typeof updateSalesOrderSchema>;

/**
 * Fulfilment ships the named lines, decrementing both on-hand and reserved
 * quantity. Omitting `items` ships every outstanding line in full.
 */
export const fulfillSalesOrderSchema = z.object({
  items: z
    .array(
      z.object({
        salesOrderItemId: idSchema,
        quantity: positiveQuantitySchema,
      }),
    )
    .optional(),
  note: noteSchema,
});
export type FulfillSalesOrderInput = z.infer<typeof fulfillSalesOrderSchema>;

export const salesOrderQuerySchema = paginationQuerySchema.extend({
  status: salesOrderStatusSchema.optional(),
  warehouseId: idSchema.optional(),
});
export type SalesOrderQuery = z.infer<typeof salesOrderQuerySchema>;
