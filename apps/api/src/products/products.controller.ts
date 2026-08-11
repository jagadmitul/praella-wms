import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  DeletionResultResponse,
  ProductListResponse,
  ProductResponse,
} from '../common/dto/response.dto';
import {
  bulkUpdateProductsSchema,
  type BulkResult,
  type Paginated,
  type ProductView,
} from '@wms/contracts';
import { createZodDto } from 'nestjs-zod';
import {
  ApiErrors,
  CurrentOrg,
  CurrentUser,
  RequirePermissions,
} from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import {
  ProductsService,
  type ProductDeletionResult,
} from './products.service';
import {
  CreateProductDto,
  ProductQueryDto,
  UpdateProductDto,
} from './dto/product.dto';

class BulkUpdateProductsDto extends createZodDto(bulkUpdateProductsSchema) {}

@ApiTags('Products')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermissions('product:read')
  @ApiOperation({
    summary: 'List products',
    description:
      'Supports full-text search across name, SKU and description, filtering by category, supplier, warehouse and active state, plus `lowStockOnly=true` to return only products below their replenishment threshold.',
  })
  @ApiOkResponse({
    type: ProductListResponse,
    description: 'Paginated products with per-warehouse stock',
  })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: ProductQueryDto,
  ): Promise<Paginated<ProductView>> {
    return this.productsService.list(orgContext, query);
  }

  @Get(':id')
  @ApiErrors('notFound')
  @RequirePermissions('product:read')
  @ApiOperation({ summary: 'Get one product with its stock breakdown' })
  @ApiOkResponse({ type: ProductResponse })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<ProductView> {
    return this.productsService.findOne(orgContext, id);
  }

  @Post()
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('product:create')
  @ApiOperation({ summary: 'Create a product' })
  @ApiCreatedResponse({ type: ProductResponse })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateProductDto,
  ): Promise<ProductView> {
    return this.productsService.create(orgContext, user.id, body);
  }

  @Patch(':id')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('product:update')
  @ApiOperation({ summary: 'Update a product' })
  @ApiOkResponse({ type: ProductResponse })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ): Promise<ProductView> {
    return this.productsService.update(orgContext, user.id, id, body);
  }

  @Post('bulk')
  @ApiErrors('validation', 'badRequest', 'notFound', 'conflict')
  @RequirePermissions('product:update')
  @ApiOperation({
    summary: 'Apply the same change to many products',
    description:
      'Each product is updated independently and the response reports per-item outcomes — one product in an unexpected state does not roll back the rest.',
  })
  @ApiOkResponse({ type: BulkResultResponse })
  async bulkUpdate(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: BulkUpdateProductsDto,
  ): Promise<BulkResult> {
    return this.productsService.bulkUpdate(orgContext, user.id, body);
  }

  @Delete(':id')
  @ApiErrors('badRequest', 'notFound', 'conflict')
  @RequirePermissions('product:delete')
  @ApiOperation({
    summary: 'Delete a product',
    description:
      'Permanently deletes the product when it has no stock and no movement history; otherwise archives it so the ledger stays intact.',
  })
  @ApiOkResponse({ type: DeletionResultResponse })
  async remove(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<ProductDeletionResult> {
    return this.productsService.remove(orgContext, user.id, id);
  }
}
