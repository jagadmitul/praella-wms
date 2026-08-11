import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  BulkJobListResponse,
  BulkJobResponse,
} from '../common/dto/response.dto';
import { parseCsvRecords } from '../common/utils/csv.util';
import { createZodDto } from 'nestjs-zod';
import {
  createBulkStockJobSchema,
  paginationQuerySchema,
  type BulkJobView,
  type Paginated,
} from '@wms/contracts';
import {
  ApiErrors,
  CurrentOrg,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
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
  @ApiErrors('validation', 'notFound')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('job:create', 'stock:adjust')
  @ApiOperation({
    summary: 'Queue a bulk stock adjustment',
    description:
      'Accepts up to 50 000 lines keyed by SKU and warehouse code, and returns immediately with a job id to poll. Lines are applied in chunked transactions; a bad line fails that line only.',
  })
  @ApiAcceptedResponse({ type: BulkJobResponse, description: 'Job queued' })
  async enqueueBulkStock(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateBulkStockJobDto,
  ): Promise<BulkJobView> {
    return this.jobsService.enqueueBulkStockAdjustment(
      orgContext,
      user.id,
      body,
    );
  }

  @Post('bulk-stock-adjustments/csv')
  @ApiErrors('validation', 'notFound')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('job:create', 'stock:adjust')
  @ApiOperation({
    summary: 'Queue a bulk stock adjustment from a CSV file',
    description:
      'Post the file as a raw `text/csv` body. Required columns: `sku`, `warehouseCode`, `delta`; optional: `reason`. Parsing happens up front so a malformed file fails fast with the offending line, rather than half-applying.',
  })
  @ApiAcceptedResponse({ type: BulkJobResponse })
  @ApiConsumes('text/csv')
  @ApiBody({
    description: 'CSV with a header row',
    schema: {
      type: 'string',
      example:
        'sku,warehouseCode,delta,reason\nELEC-MOU-02,SRT-HUB,5,Cycle count',
    },
  })
  @ApiAcceptedResponse({ description: 'Job queued' })
  async enqueueBulkStockCsv(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() csv: unknown,
  ): Promise<BulkJobView> {
    if (typeof csv !== 'string' || csv.trim() === '') {
      throw new BadRequestException(
        'Send the CSV as a raw text/csv body, e.g. curl --data-binary @stock.csv -H "Content-Type: text/csv"',
      );
    }

    const lines = JobsController.parseStockCsv(csv);
    return this.jobsService.enqueueBulkStockAdjustment(orgContext, user.id, {
      lines,
    });
  }

  @Get()
  @RequirePermissions('job:read')
  @ApiOperation({ summary: 'List background jobs' })
  @ApiOkResponse({ type: BulkJobListResponse })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: JobQueryDto,
  ): Promise<Paginated<BulkJobView>> {
    return this.jobsService.list(orgContext, query);
  }

  @Get(':id')
  @ApiErrors('notFound')
  @RequirePermissions('job:read')
  @ApiOperation({ summary: 'Poll a job’s progress' })
  @ApiOkResponse({ type: BulkJobResponse })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<BulkJobView> {
    return this.jobsService.findOne(orgContext, id);
  }

  /**
   * Converts CSV text into job lines, reporting the first structural problem
   * with its line number. Validating up front means a typo in the header never
   * results in a half-applied job.
   */
  private static parseStockCsv(csv: string): Array<{
    sku: string;
    warehouseCode: string;
    delta: number;
    reason?: string;
  }> {
    const records = parseCsvRecords(csv);

    if (records.length === 0) {
      throw new BadRequestException(
        'The CSV contains a header but no data rows',
      );
    }

    return records.map((record, index) => {
      const line = index + 2; // +1 for the header, +1 for 1-based numbering
      const sku = record.sku ?? record.SKU ?? '';
      const warehouseCode = record.warehouseCode ?? record.warehouse ?? '';
      const rawDelta = record.delta ?? '';

      if (!sku)
        throw new BadRequestException(`Line ${line}: "sku" is required`);
      if (!warehouseCode) {
        throw new BadRequestException(
          `Line ${line}: "warehouseCode" is required`,
        );
      }

      const delta = Number(rawDelta);
      if (!Number.isInteger(delta)) {
        throw new BadRequestException(
          `Line ${line}: "delta" must be a whole number, got "${rawDelta}"`,
        );
      }

      return {
        sku,
        warehouseCode,
        delta,
        ...(record.reason ? { reason: record.reason } : {}),
      };
    });
  }
}
