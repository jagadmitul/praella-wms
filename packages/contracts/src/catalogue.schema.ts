import { z } from 'zod';
import {
  idSchema,
  moneySchema,
  noteSchema,
  paginationQuerySchema,
  quantitySchema,
  shortTextSchema,
} from './common';

/**
 * A short human-facing code (warehouse code, SKU, order number). Normalised to
 * uppercase so `sku-1` and `SKU-1` can never coexist inside one organisation.
 */
export const codeSchema = z
  .string()
  .trim()
  .min(2, 'Code must be at least 2 characters')
  .max(40, 'Code must be at most 40 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use letters, digits, dot, dash or underscore')
  .transform((value) => value.toUpperCase());

/* -------------------------------------------------------------------------- */
/*                                  Warehouse                                 */
/* -------------------------------------------------------------------------- */

export const warehouseAddressSchema = z.object({
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(24).optional(),
});

export const createWarehouseSchema = warehouseAddressSchema.extend({
  name: shortTextSchema,
  code: codeSchema,
  isActive: z.boolean().default(true),
  notes: noteSchema,
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const updateWarehouseSchema = createWarehouseSchema.partial();
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

export const warehouseQuerySchema = paginationQuerySchema.extend({
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
});
export type WarehouseQuery = z.infer<typeof warehouseQuerySchema>;

/** Grants a STAFF membership access to a specific warehouse. */
export const assignWarehouseMembersSchema = z.object({
  membershipIds: z.array(idSchema).min(1, 'Select at least one member'),
});
export type AssignWarehouseMembersInput = z.infer<typeof assignWarehouseMembersSchema>;

/* -------------------------------------------------------------------------- */
/*                                  Category                                  */
/* -------------------------------------------------------------------------- */

export const createCategorySchema = z.object({
  name: shortTextSchema,
  description: noteSchema,
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/* -------------------------------------------------------------------------- */
/*                                  Supplier                                  */
/* -------------------------------------------------------------------------- */

export const createSupplierSchema = z.object({
  name: shortTextSchema,
  contactName: z.string().trim().max(160).optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: 'Enter a valid email address',
    })
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().max(400).optional(),
  notes: noteSchema,
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

/* -------------------------------------------------------------------------- */
/*                                   Product                                  */
/* -------------------------------------------------------------------------- */

export const createProductSchema = z.object({
  name: shortTextSchema,
  sku: codeSchema,
  description: noteSchema,
  categoryId: idSchema.optional(),
  supplierId: idSchema.optional(),
  unitPrice: moneySchema,
  /** Unit of measure, e.g. `pcs`, `kg`, `box`. */
  unit: z.string().trim().min(1).max(16).default('pcs'),
  /** Default reorder point copied onto new stock levels for this product. */
  defaultReorderPoint: quantitySchema.default(0),
  /** Default quantity to reorder when the threshold is breached. */
  defaultReorderQuantity: quantitySchema.default(0),
  isActive: z.boolean().default(true),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productQuerySchema = paginationQuerySchema.extend({
  categoryId: idSchema.optional(),
  supplierId: idSchema.optional(),
  warehouseId: idSchema.optional(),
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
  /** When true, only products at or below their reorder point are returned. */
  lowStockOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
    .optional(),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

/* -------------------------------------------------------------------------- */
/*                                Bulk actions                                */
/* -------------------------------------------------------------------------- */

/** Applies the same change to many products at once. */
export const bulkUpdateProductsSchema = z
  .object({
    ids: z.array(idSchema).min(1, 'Select at least one product').max(200),
    isActive: z.boolean().optional(),
    categoryId: idSchema.nullable().optional(),
    supplierId: idSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.isActive !== undefined ||
      value.categoryId !== undefined ||
      value.supplierId !== undefined,
    { message: 'Choose at least one field to change' },
  );
export type BulkUpdateProductsInput = z.infer<typeof bulkUpdateProductsSchema>;
