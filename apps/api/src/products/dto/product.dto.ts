import { createZodDto } from 'nestjs-zod';
import {
  createProductSchema,
  productQuerySchema,
  updateProductSchema,
} from '@wms/contracts';

export class CreateProductDto extends createZodDto(createProductSchema) {}
export class UpdateProductDto extends createZodDto(updateProductSchema) {}
export class ProductQueryDto extends createZodDto(productQuerySchema) {}
