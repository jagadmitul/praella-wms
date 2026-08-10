import { createZodDto } from 'nestjs-zod';
import {
  createPurchaseOrderSchema,
  createSalesOrderSchema,
  fulfillSalesOrderSchema,
  purchaseOrderQuerySchema,
  receivePurchaseOrderSchema,
  salesOrderQuerySchema,
  updatePurchaseOrderSchema,
  updateSalesOrderSchema,
} from '@wms/contracts';

export class CreatePurchaseOrderDto extends createZodDto(createPurchaseOrderSchema) {}
export class UpdatePurchaseOrderDto extends createZodDto(updatePurchaseOrderSchema) {}
export class ReceivePurchaseOrderDto extends createZodDto(receivePurchaseOrderSchema) {}
export class PurchaseOrderQueryDto extends createZodDto(purchaseOrderQuerySchema) {}

export class CreateSalesOrderDto extends createZodDto(createSalesOrderSchema) {}
export class UpdateSalesOrderDto extends createZodDto(updateSalesOrderSchema) {}
export class FulfillSalesOrderDto extends createZodDto(fulfillSalesOrderSchema) {}
export class SalesOrderQueryDto extends createZodDto(salesOrderQuerySchema) {}
