import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  LowStockItemView,
  Paginated,
  StockLevelView,
  StockMovementView,
} from '@wms/contracts';
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { StockService } from './stock.service';
import {
  AdjustStockDto,
  MovementQueryDto,
  RecordMovementDto,
  SetReplenishmentRuleDto,
  StockLevelQueryDto,
} from './dto/stock.dto';

@ApiTags('Stock')
@ApiBearerAuth('access-token')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('levels')
  @RequirePermissions('stock:read')
  @ApiOperation({
    summary: 'List stock levels across products and warehouses',
    description: 'Staff see only the warehouses they are assigned to.',
  })
  @ApiOkResponse({ description: 'Paginated stock levels' })
  async listLevels(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: StockLevelQueryDto,
  ): Promise<Paginated<StockLevelView>> {
    return this.stockService.listLevels(orgContext, query);
  }

  @Get('movements')
  @RequirePermissions('movement:read')
  @ApiOperation({
    summary: 'Stock movement history',
    description:
      'The append-only ledger, newest first. Filterable by product, warehouse, movement type and date range.',
  })
  @ApiOkResponse({ description: 'Paginated stock movements' })
  async listMovements(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: MovementQueryDto,
  ): Promise<Paginated<StockMovementView>> {
    return this.stockService.listMovements(orgContext, query);
  }

  @Post('movements')
  @RequirePermissions('movement:record')
  @ApiOperation({
    summary: 'Record an inbound or outbound movement',
    description:
      'The one stock write available to STAFF. Outbound movements may not consume stock reserved by open sales orders.',
  })
  async recordMovement(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: RecordMovementDto,
  ): Promise<StockLevelView> {
    return this.stockService.recordMovement(orgContext, user.id, body);
  }

  @Post('adjustments')
  @RequirePermissions('stock:adjust')
  @ApiOperation({
    summary: 'Apply a manual stock adjustment (manager and admin only)',
    description: 'Used to correct stock after a physical count. Requires a reason.',
  })
  async adjust(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: AdjustStockDto,
  ): Promise<StockLevelView> {
    return this.stockService.adjust(orgContext, user.id, body);
  }

  @Put('replenishment-rules')
  @RequirePermissions('replenishment:manage')
  @ApiOperation({
    summary: 'Set the minimum stock threshold for a product in a warehouse',
    description:
      'Thresholds are per (product, warehouse) pair, because the same SKU warrants different safety stock at a hub than at a spoke.',
  })
  async setReplenishmentRule(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: SetReplenishmentRuleDto,
  ): Promise<StockLevelView> {
    return this.stockService.setReplenishmentRule(orgContext, user.id, body);
  }

  @Get('low-stock')
  @RequirePermissions('replenishment:read')
  @ApiOperation({
    summary: 'Products at or below their replenishment threshold',
    description:
      'Returns the shortfall and a suggested order quantity per line, most urgent first.',
  })
  @ApiOkResponse({ description: 'Low-stock lines' })
  async lowStock(
    @CurrentOrg() orgContext: OrgContext,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<LowStockItemView[]> {
    return this.stockService.lowStock(orgContext, warehouseId);
  }
}
