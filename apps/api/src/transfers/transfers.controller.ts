import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
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
  StockTransferListResponse,
  StockTransferResponse,
} from '../common/dto/response.dto';
import { createZodDto } from 'nestjs-zod';
import {
  bulkTransitionSchema,
  type BulkResult,
  type Paginated,
  type StockTransferView,
} from '@wms/contracts';
import { runBulk } from '../common/services/bulk.util';

import {
  ApiErrors,
  CurrentOrg,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { TransfersService } from './transfers.service';
import { CreateTransferDto, TransferQueryDto } from './dto/transfer.dto';

class BulkTransitionDto extends createZodDto(bulkTransitionSchema) {}

@ApiTags('Stock transfers')
@ApiBearerAuth('access-token')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @RequirePermissions('stock:read')
  @ApiOperation({
    summary: 'List stock transfers',
    description:
      'Staff see transfers where either end is one of their assigned warehouses.',
  })
  @ApiOkResponse({
    type: StockTransferListResponse,
    description: 'Paginated transfers',
  })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: TransferQueryDto,
  ): Promise<Paginated<StockTransferView>> {
    return this.transfersService.list(orgContext, query);
  }

  @Get(':id')
  @ApiErrors('notFound')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Get one transfer' })
  @ApiOkResponse({ type: StockTransferResponse })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.findOne(orgContext, id);
  }

  @Post()
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('stock:transfer')
  @ApiOperation({ summary: 'Create a draft transfer between two warehouses' })
  @ApiCreatedResponse({ type: StockTransferResponse })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateTransferDto,
  ): Promise<StockTransferView> {
    return this.transfersService.create(orgContext, user.id, body);
  }

  @Post(':id/dispatch')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('stock:transfer')
  @ApiOperation({
    summary: 'Dispatch a draft transfer',
    description:
      'Removes the stock from the source warehouse and marks the transfer in transit.',
  })
  @ApiCreatedResponse({ type: StockTransferResponse })
  async dispatch(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.dispatch(orgContext, user.id, id);
  }

  @Post(':id/receive')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('stock:transfer')
  @ApiOperation({
    summary: 'Receive an in-transit transfer',
    description:
      'Adds the stock to the destination warehouse and completes the transfer.',
  })
  @ApiCreatedResponse({ type: StockTransferResponse })
  async receive(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.receive(orgContext, user.id, id);
  }

  @Post('bulk')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('stock:transfer')
  @ApiOperation({
    summary: 'Run one transition across many transfers',
    description: 'Supported transitions: dispatch, receive, cancel.',
  })
  @ApiCreatedResponse({ type: BulkResultResponse })
  async bulk(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: BulkTransitionDto,
  ): Promise<BulkResult> {
    const allowed = ['dispatch', 'receive', 'cancel'] as const;
    if (!allowed.includes(body.transition as (typeof allowed)[number])) {
      throw new BadRequestException(
        `Unsupported transition "${body.transition}". Use one of: ${allowed.join(', ')}`,
      );
    }

    return runBulk(
      body.ids.map((id) => ({ id, label: id })),
      async (item) => {
        if (body.transition === 'dispatch') {
          await this.transfersService.dispatch(orgContext, user.id, item.id);
        } else if (body.transition === 'receive') {
          await this.transfersService.receive(orgContext, user.id, item.id);
        } else {
          await this.transfersService.cancel(orgContext, user.id, item.id);
        }
      },
    );
  }

  @Post(':id/cancel')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('stock:transfer')
  @ApiOperation({
    summary: 'Cancel a transfer',
    description:
      'Stock already dispatched is returned to the source warehouse.',
  })
  @ApiCreatedResponse({ type: StockTransferResponse })
  async cancel(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<StockTransferView> {
    return this.transfersService.cancel(orgContext, user.id, id);
  }
}
