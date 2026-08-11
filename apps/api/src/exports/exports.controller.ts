import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
import type { OrgContext } from '../common/types/request-context';
import { ExportsService } from './exports.service';

/**
 * CSV exports.
 *
 * Streamed straight to the response rather than buffered: a full movement
 * ledger can be hundreds of thousands of rows, and holding that in memory to
 * build one string is how an export endpoint takes the process down.
 */
@ApiTags('Exports')
@ApiBearerAuth('access-token')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('products.csv')
  @RequirePermissions('product:read')
  @ApiOperation({ summary: 'Export the product catalogue as CSV' })
  @ApiOkResponse({
    description:
      'RFC 4180 CSV. Columns: sku, name, category, supplier, unitPrice, unitOfMeasure, onHand, reserved, available.',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async products(
    @CurrentOrg() orgContext: OrgContext,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="products.csv"',
    );
    await this.exportsService.streamProducts(orgContext, response);
  }

  @Get('stock-levels.csv')
  @RequirePermissions('stock:read')
  @ApiOperation({ summary: 'Export current stock levels as CSV' })
  @ApiOkResponse({
    description:
      'RFC 4180 CSV. Columns: warehouseCode, sku, productName, quantity, reservedQuantity, availableQuantity, reorderPoint.',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async stockLevels(
    @CurrentOrg() orgContext: OrgContext,
    @Res() response: Response,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<void> {
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="stock-levels.csv"',
    );
    await this.exportsService.streamStockLevels(
      orgContext,
      response,
      warehouseId,
    );
  }

  @Get('movements.csv')
  @RequirePermissions('movement:read')
  @ApiOperation({
    summary: 'Export the stock movement ledger as CSV',
    description:
      'Streamed in batches, so the whole ledger never sits in memory.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description:
      'RFC 4180 CSV. Columns: occurredAt, warehouseCode, sku, type, quantity, reference, reason, actor.',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async movements(
    @CurrentOrg() orgContext: OrgContext,
    @Res() response: Response,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<void> {
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="stock-movements.csv"',
    );
    await this.exportsService.streamMovements(
      orgContext,
      response,
      warehouseId,
    );
  }
}
