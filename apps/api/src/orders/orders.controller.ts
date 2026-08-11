import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  BulkResultResponse,
  PurchaseOrderListResponse,
  PurchaseOrderResponse,
  SalesOrderListResponse,
  SalesOrderResponse,
} from '../common/dto/response.dto';
import {
  bulkTransitionSchema,
  replacePurchaseOrderLinesSchema,
  replaceSalesOrderLinesSchema,
  type BulkResult,
  type Paginated,
  type PurchaseOrderView,
  type SalesOrderView,
} from '@wms/contracts';
import { createZodDto } from 'nestjs-zod';
import { runBulk } from '../common/services/bulk.util';
import {
  ApiErrors,
  CurrentOrg,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
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

class BulkTransitionDto extends createZodDto(bulkTransitionSchema) {}
class ReplacePurchaseOrderLinesDto extends createZodDto(
  replacePurchaseOrderLinesSchema,
) {}
class ReplaceSalesOrderLinesDto extends createZodDto(
  replaceSalesOrderLinesSchema,
) {}

@ApiTags('Purchase orders')
@ApiBearerAuth('access-token')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @Get()
  @RequirePermissions('purchase_order:read')
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiOkResponse({
    type: PurchaseOrderListResponse,
    description: 'Paginated purchase orders',
  })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: PurchaseOrderQueryDto,
  ): Promise<Paginated<PurchaseOrderView>> {
    return this.purchaseOrdersService.list(orgContext, query);
  }

  @Get(':id')
  @ApiErrors('notFound')
  @RequirePermissions('purchase_order:read')
  @ApiOperation({ summary: 'Get one purchase order' })
  @ApiOkResponse({ type: PurchaseOrderResponse })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.findOne(orgContext, id);
  }

  @Post()
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({
    summary: 'Create a purchase order',
    description:
      'Raising an order does not change stock; only receiving goods does.',
  })
  @ApiCreatedResponse({ type: PurchaseOrderResponse })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.create(orgContext, user.id, body);
  }

  @Patch(':id')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({ summary: 'Update a draft or submitted purchase order' })
  @ApiOkResponse({ type: PurchaseOrderResponse })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.update(orgContext, user.id, id, body);
  }

  @Put(':id/items')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({
    summary: 'Replace the line items on a draft purchase order',
    description:
      'Whole-set replace rather than per-line edits, so the order can never be left half-edited. Draft only — a submitted order has been seen by the supplier, and a received one is bound to ledger entries.',
  })
  @ApiOkResponse({ type: PurchaseOrderResponse })
  async replaceLines(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: ReplacePurchaseOrderLinesDto,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.replaceLines(
      orgContext,
      user.id,
      id,
      body,
    );
  }

  @Post(':id/submit')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({ summary: 'Submit a draft purchase order to the supplier' })
  @ApiCreatedResponse({ type: PurchaseOrderResponse })
  async submit(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.submit(orgContext, user.id, id);
  }

  @Post(':id/receive')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('purchase_order:receive')
  @ApiOperation({
    summary: 'Receive goods against a purchase order',
    description:
      "Increases stock at the order's warehouse and writes the matching ledger entries. Omit `items` to receive every outstanding line in full.",
  })
  @ApiCreatedResponse({ type: PurchaseOrderResponse })
  async receive(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: ReceivePurchaseOrderDto,
  ): Promise<PurchaseOrderView> {
    return this.purchaseOrdersService.receive(orgContext, user.id, id, body);
  }

  @Post('bulk')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({
    summary: 'Run one transition across many purchase orders',
    description:
      'Supported transitions: submit, receive, cancel. Orders are processed independently, so one in the wrong state does not abort the others.',
  })
  @ApiCreatedResponse({ type: BulkResultResponse })
  async bulk(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: BulkTransitionDto,
  ): Promise<BulkResult> {
    const allowed = ['submit', 'receive', 'cancel'] as const;
    if (!allowed.includes(body.transition as (typeof allowed)[number])) {
      throw new BadRequestException(
        `Unsupported transition "${body.transition}". Use one of: ${allowed.join(', ')}`,
      );
    }

    return runBulk(
      body.ids.map((id) => ({ id, label: id })),
      async (item) => {
        if (body.transition === 'submit') {
          await this.purchaseOrdersService.submit(orgContext, user.id, item.id);
        } else if (body.transition === 'receive') {
          await this.purchaseOrdersService.receive(
            orgContext,
            user.id,
            item.id,
            {
              note: undefined,
            },
          );
        } else {
          await this.purchaseOrdersService.cancel(orgContext, user.id, item.id);
        }
      },
    );
  }

  @Post(':id/cancel')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('purchase_order:manage')
  @ApiOperation({
    summary: 'Cancel a purchase order that has received no goods',
  })
  @ApiCreatedResponse({ type: PurchaseOrderResponse })
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
  @ApiOkResponse({
    type: SalesOrderListResponse,
    description: 'Paginated sales orders',
  })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: SalesOrderQueryDto,
  ): Promise<Paginated<SalesOrderView>> {
    return this.salesOrdersService.list(orgContext, query);
  }

  @Get(':id')
  @ApiErrors('notFound')
  @RequirePermissions('sales_order:read')
  @ApiOperation({ summary: 'Get one sales order' })
  @ApiOkResponse({ type: SalesOrderResponse })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.findOne(orgContext, id);
  }

  @Post()
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({ summary: 'Create a sales / dispatch order' })
  @ApiCreatedResponse({ type: SalesOrderResponse })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateSalesOrderDto,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.create(orgContext, user.id, body);
  }

  @Patch(':id')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({ summary: 'Update a draft or allocated sales order' })
  @ApiOkResponse({ type: SalesOrderResponse })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateSalesOrderDto,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.update(orgContext, user.id, id, body);
  }

  @Put(':id/items')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({
    summary: 'Replace the line items on a draft sales order',
    description:
      'Draft only: an allocated order holds reservations keyed to its current lines, and rewriting them underneath would strand reserved stock.',
  })
  @ApiOkResponse({ type: SalesOrderResponse })
  async replaceLines(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: ReplaceSalesOrderLinesDto,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.replaceLines(orgContext, user.id, id, body);
  }

  @Post(':id/allocate')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({
    summary: 'Reserve stock for a draft order',
    description:
      'Reserves units without moving them, so two orders cannot promise the same last item. Fails if any line cannot be covered by available stock.',
  })
  @ApiCreatedResponse({ type: SalesOrderResponse })
  async allocate(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.allocate(orgContext, user.id, id);
  }

  @Post(':id/fulfill')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('sales_order:fulfill')
  @ApiOperation({
    summary: 'Ship lines from an allocated order',
    description:
      'Converts reservations into outbound stock movements. Omit `items` to ship every outstanding line in full.',
  })
  @ApiCreatedResponse({ type: SalesOrderResponse })
  async fulfill(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: FulfillSalesOrderDto,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.fulfill(orgContext, user.id, id, body);
  }

  @Post('bulk')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({
    summary: 'Run one transition across many sales orders',
    description: 'Supported transitions: allocate, fulfill, cancel.',
  })
  @ApiCreatedResponse({ type: BulkResultResponse })
  async bulk(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: BulkTransitionDto,
  ): Promise<BulkResult> {
    const allowed = ['allocate', 'fulfill', 'cancel'] as const;
    if (!allowed.includes(body.transition as (typeof allowed)[number])) {
      throw new BadRequestException(
        `Unsupported transition "${body.transition}". Use one of: ${allowed.join(', ')}`,
      );
    }

    return runBulk(
      body.ids.map((id) => ({ id, label: id })),
      async (item) => {
        if (body.transition === 'allocate') {
          await this.salesOrdersService.allocate(orgContext, user.id, item.id);
        } else if (body.transition === 'fulfill') {
          await this.salesOrdersService.fulfill(orgContext, user.id, item.id, {
            note: undefined,
          });
        } else {
          await this.salesOrdersService.cancel(orgContext, user.id, item.id);
        }
      },
    );
  }

  @Post(':id/cancel')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('sales_order:manage')
  @ApiOperation({
    summary: 'Cancel a sales order',
    description: 'Releases any stock the order still has reserved.',
  })
  @ApiCreatedResponse({ type: SalesOrderResponse })
  async cancel(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<SalesOrderView> {
    return this.salesOrdersService.cancel(orgContext, user.id, id);
  }
}
