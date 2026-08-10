import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, StockTransferView } from '@wms/contracts';
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { TransfersService } from './transfers.service';
import { CreateTransferDto, TransferQueryDto } from './dto/transfer.dto';

@ApiTags('Stock transfers')
@ApiBearerAuth('access-token')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @RequirePermissions('stock:read')
  @ApiOperation({
    summary: 'List stock transfers',
    description: 'Staff see transfers where either end is one of their assigned warehouses.',
  })
  @ApiOkResponse({ description: 'Paginated transfers' })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: TransferQueryDto,
  ): Promise<Paginated<StockTransferView>> {
    return this.transfersService.list(orgContext, query);
  }

  @Get(':id')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Get one transfer' })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.findOne(orgContext, id);
  }

  @Post()
  @RequirePermissions('stock:transfer')
  @ApiOperation({ summary: 'Create a draft transfer between two warehouses' })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateTransferDto,
  ): Promise<StockTransferView> {
    return this.transfersService.create(orgContext, user.id, body);
  }

  @Post(':id/dispatch')
  @RequirePermissions('stock:transfer')
  @ApiOperation({
    summary: 'Dispatch a draft transfer',
    description: 'Removes the stock from the source warehouse and marks the transfer in transit.',
  })
  async dispatch(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.dispatch(orgContext, user.id, id);
  }

  @Post(':id/receive')
  @RequirePermissions('stock:transfer')
  @ApiOperation({
    summary: 'Receive an in-transit transfer',
    description: 'Adds the stock to the destination warehouse and completes the transfer.',
  })
  async receive(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.receive(orgContext, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions('stock:transfer')
  @ApiOperation({
    summary: 'Cancel a transfer',
    description: 'Stock already dispatched is returned to the source warehouse.',
  })
  async cancel(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.cancel(orgContext, user.id, id);
  }
}
