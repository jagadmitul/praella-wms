import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  createBulkStockJobSchema,
  paginationQuerySchema,
  type BulkJobView,
  type Paginated,
} from '@wms/contracts';
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { JobsService } from './jobs.service';

class CreateBulkStockJobDto extends createZodDto(createBulkStockJobSchema) {}
class JobQueryDto extends createZodDto(paginationQuerySchema) {}

@ApiTags('Background jobs')
@ApiBearerAuth('access-token')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('bulk-stock-adjustments')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('job:create', 'stock:adjust')
  @ApiOperation({
    summary: 'Queue a bulk stock adjustment',
    description:
      'Accepts up to 50 000 lines keyed by SKU and warehouse code, and returns immediately with a job id to poll. Lines are applied in chunked transactions; a bad line fails that line only.',
  })
  @ApiAcceptedResponse({ description: 'Job queued' })
  async enqueueBulkStock(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateBulkStockJobDto,
  ): Promise<BulkJobView> {
    return this.jobsService.enqueueBulkStockAdjustment(orgContext, user.id, body);
  }

  @Get()
  @RequirePermissions('job:read')
  @ApiOperation({ summary: 'List background jobs' })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: JobQueryDto,
  ): Promise<Paginated<BulkJobView>> {
    return this.jobsService.list(orgContext, query);
  }

  @Get(':id')
  @RequirePermissions('job:read')
  @ApiOperation({ summary: 'Poll a job’s progress' })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<BulkJobView> {
    return this.jobsService.findOne(orgContext, id);
  }
}
