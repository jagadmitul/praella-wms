import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, WarehouseView } from '@wms/contracts';
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import {
  WarehousesService,
  type WarehouseDeletionResult,
} from './warehouses.service';
import {
  AssignWarehouseMembersDto,
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseQueryDto,
} from './dto/warehouse.dto';

@ApiTags('Warehouses')
@ApiBearerAuth('access-token')
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @RequirePermissions('warehouse:read')
  @ApiOperation({
    summary: 'List warehouses',
    description:
      'Admins and managers see every warehouse in the organisation; staff see only the warehouses they are assigned to.',
  })
  @ApiOkResponse({ description: 'Paginated warehouses with stock statistics' })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: WarehouseQueryDto,
  ): Promise<Paginated<WarehouseView>> {
    return this.warehousesService.list(orgContext, query);
  }

  @Get(':id')
  @RequirePermissions('warehouse:read')
  @ApiOperation({ summary: 'Get one warehouse' })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<WarehouseView> {
    return this.warehousesService.findOne(orgContext, id);
  }

  @Post()
  @RequirePermissions('warehouse:create')
  @ApiOperation({ summary: 'Create a warehouse' })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateWarehouseDto,
  ): Promise<WarehouseView> {
    return this.warehousesService.create(orgContext, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('warehouse:update')
  @ApiOperation({ summary: 'Update a warehouse' })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateWarehouseDto,
  ): Promise<WarehouseView> {
    return this.warehousesService.update(orgContext, user.id, id, body);
  }

  @Delete(':id')
  @RequirePermissions('warehouse:delete')
  @ApiOperation({
    summary: 'Delete a warehouse (admin only)',
    description:
      'Permanently deletes the warehouse when it has no stock, no movement history and no open orders. Otherwise it is archived so the stock ledger stays intact.',
  })
  async remove(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<WarehouseDeletionResult> {
    return this.warehousesService.remove(orgContext, user.id, id);
  }

  @Put(':id/members')
  @RequirePermissions('warehouse:assign')
  @ApiOperation({
    summary: 'Replace the staff assigned to a warehouse',
    description: 'Assignments only restrict STAFF members; admins and managers see all sites.',
  })
  async assignMembers(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: AssignWarehouseMembersDto,
  ): Promise<{ assigned: number }> {
    return this.warehousesService.assignMembers(orgContext, user.id, id, body.membershipIds);
  }
}
