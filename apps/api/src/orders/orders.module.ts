import { Module } from '@nestjs/common';
import { PurchaseOrdersController, SalesOrdersController } from './orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SalesOrdersService } from './sales-orders.service';

/** Inbound (purchase) and outbound (sales / dispatch) order flows. */
@Module({
  controllers: [PurchaseOrdersController, SalesOrdersController],
  providers: [PurchaseOrdersService, SalesOrdersService],
  exports: [PurchaseOrdersService, SalesOrdersService],
})
export class OrdersModule {}
