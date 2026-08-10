import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, PurchaseOrderView, SalesOrderView } from '@wms/contracts';
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SalesOrdersService } from './sales-orders.service';
import {
  CreatePurchaseOrderDto,
  CreateSalesOrderDto,
  FulfillSalesOrderDto,
  PurchaseOrderQueryDto,
  ReceivePurchaseOrderDto,
  SalesOrderQueryDto,
  UpdatePurchaseOrderDto,
  UpdateSalesOrderDto,
} from './dto/order.dto';

@ApiTags('Purchase orders')
@ApiBearerAuth('access-token')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions('purchase_order:read')
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiOkResponse({ description: 'Paginated purchase orders' })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: PurchaseOrderQueryDto,
  ): Promise<Paginated<PurchaseOrderView>> {
    return this.purchaseOrdersService.list(orgContext, query);
  }

  @Get(':id')
  @RequirePermissions('purchase_order:read')
  @ApiOperation({ summary: 'Get one purchase order' })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.findOne(orgContext, id);
  }

  @Post()
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({
    summary: 'Create a purchase order',
    description: 'Raising an order does not change stock; only receiving goods does.',
  })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.create(orgContext, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({ summary: 'Update a draft or submitted purchase order' })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.update(orgContext, user.id, id, body);
  }

  @Post(':id/submit')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({ summary: 'Submit a draft purchase order to the supplier' })
  async submit(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.submit(orgContext, user.id, id);
  }

  @Post(':id/receive')
  @RequirePermissions('purchase_order:receive')
  @ApiOperation({
    summary: 'Receive goods against a purchase order',
    description:
      'Increases stock at the order\'s warehouse and writes the matching ledger entries. Omit `items` to receive every outstanding line in full.',
  })
  async receive(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: ReceivePurchaseOrderDto,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.receive(orgContext, user.id, id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({ summary: 'Cancel a purchase order that has received no goods' })
  async cancel(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.cancel(orgContext, user.id, id);
  }
}

@ApiTags('Sales orders')
@ApiBearerAuth('access-token')
@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Get()
  @RequirePermissions('sales_order:read')
  @ApiOperation({ summary: 'List sales orders' })
  @ApiOkResponse({ description: 'Paginated sales orders' })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: SalesOrderQueryDto,
  ): Promise<Paginated<SalesOrderView>> {
    return this.salesOrdersService.list(orgContext, query);
  }

  @Get(':id')
  @RequirePermissions('sales_order:read')
  @ApiOperation({ summary: 'Get one sales order' })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.findOne(orgContext, id);
  }

  @Post()
  @RequirePermissions('sales_order:manage')
  @ApiOperation({ summary: 'Create a sales / dispatch order' })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateSalesOrderDto,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.create(orgContext, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({ summary: 'Update a draft or allocated sales order' })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateSalesOrderDto,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.update(orgContext, user.id, id, body);
  }

  @Post(':id/allocate')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({
    summary: 'Reserve stock for a draft order',
    description:
      'Reserves units without moving them, so two orders cannot promise the same last item. Fails if any line cannot be covered by available stock.',
  })
  async allocate(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.allocate(orgContext, user.id, id);
  }

  @Post(':id/fulfill')
  @RequirePermissions('sales_order:fulfill')
  @ApiOperation({
    summary: 'Ship lines from an allocated order',
    description:
      'Converts reservations into outbound stock movements. Omit `items` to ship every outstanding line in full.',
  })
  async fulfill(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: FulfillSalesOrderDto,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.fulfill(orgContext, user.id, id, body);
  }

  @Post(':id/cancel')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({
    summary: 'Cancel a sales order',
    description: 'Releases any stock the order still has reserved.',
  })
  async cancel(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.cancel(orgContext, user.id, id);
  }
}
