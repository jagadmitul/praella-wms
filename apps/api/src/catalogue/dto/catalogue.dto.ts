import { createZodDto } from 'nestjs-zod';
import {
  createCategorySchema,
  createSupplierSchema,
  paginationQuerySchema,
  updateCategorySchema,
  updateSupplierSchema,
} from '@wms/contracts';

export class CreateCategoryDto extends createZodDto(createCategorySchema) {}
export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
export class CreateSupplierDto extends createZodDto(createSupplierSchema) {}
export class UpdateSupplierDto extends createZodDto(updateSupplierSchema) {}
export class CatalogueQueryDto extends createZodDto(paginationQuerySchema) {}
