import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, ProductView } from '@wms/contracts';
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
import type { OrgContext, RequestUser } from '../common/types/request-context';
import { ProductsService, type ProductDeletionResult } from './products.service';
import { CreateProductDto, ProductQueryDto, UpdateProductDto } from './dto/product.dto';

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
  @ApiOkResponse({ description: 'Paginated products with per-warehouse stock' })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: ProductQueryDto,
  ): Promise<Paginated<ProductView>> {
    return this.productsService.list(orgContext, query);
  }

  @Get(':id')
  @RequirePermissions('product:read')
  @ApiOperation({ summary: 'Get one product with its stock breakdown' })
  async findOne(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<ProductView> {
    return this.productsService.findOne(orgContext, id);
  }

  @Post()
  @RequirePermissions('product:create')
  @ApiOperation({ summary: 'Create a product' })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Body() body: CreateProductDto,
  ): Promise<ProductView> {
    return this.productsService.create(orgContext, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions('product:update')
  @ApiOperation({ summary: 'Update a product' })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ): Promise<ProductView> {
    return this.productsService.update(orgContext, user.id, id, body);
  }

  @Delete(':id')
  @RequirePermissions('product:delete')
  @ApiOperation({
    summary: 'Delete a product',
    description:
      'Permanently deletes the product when it has no stock and no movement history; otherwise archives it so the ledger stays intact.',
  })
  async remove(
    @CurrentOrg() orgContext: OrgContext,
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<ProductDeletionResult> {
    return this.productsService.remove(orgContext, user.id, id);
  }
}
