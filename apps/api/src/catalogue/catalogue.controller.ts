import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CategoryListResponse,
  CategoryResponse,
  SupplierListResponse,
  SupplierResponse,
} from '../common/dto/response.dto';
import type { CategoryView, Paginated, SupplierView } from '@wms/contracts';
import {
  ApiErrors,
  CurrentOrg,
  RequirePermissions,
} from '../common/decorators';
import type { OrgContext } from '../common/types/request-context';
import { CategoriesService } from './categories.service';
import { SuppliersService } from './suppliers.service';
import {
  CatalogueQueryDto,
  CreateCategoryDto,
  CreateSupplierDto,
  UpdateCategoryDto,
  UpdateSupplierDto,
} from './dto/catalogue.dto';

@ApiTags('Categories')
@ApiBearerAuth('access-token')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermissions('category:read')
  @ApiOperation({ summary: 'List product categories' })
  @ApiOkResponse({ type: CategoryListResponse })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: CatalogueQueryDto,
  ): Promise<Paginated<CategoryView>> {
    return this.categoriesService.list(orgContext, query);
  }

  @Post()
  @ApiErrors('validation', 'notFound', 'conflict')
  @RequirePermissions('category:manage')
  @ApiOperation({ summary: 'Create a category' })
  @ApiCreatedResponse({ type: CategoryResponse })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @Body() body: CreateCategoryDto,
  ): Promise<CategoryView> {
    return this.categoriesService.create(orgContext, body);
  }

  @Patch(':id')
  @ApiErrors('validation', 'notFound', 'conflict')
  @RequirePermissions('category:manage')
  @ApiOperation({ summary: 'Update a category' })
  @ApiOkResponse({ type: CategoryResponse })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
  ): Promise<CategoryView> {
    return this.categoriesService.update(orgContext, id, body);
  }

  @Delete(':id')
  @ApiErrors('notFound', 'conflict')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Category deleted.' })
  @RequirePermissions('category:manage')
  @ApiOperation({ summary: 'Delete an unused category' })
  async remove(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.categoriesService.remove(orgContext, id);
  }
}

@ApiTags('Suppliers')
@ApiBearerAuth('access-token')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @RequirePermissions('supplier:read')
  @ApiOperation({ summary: 'List suppliers' })
  @ApiOkResponse({ type: SupplierListResponse })
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: CatalogueQueryDto,
  ): Promise<Paginated<SupplierView>> {
    return this.suppliersService.list(orgContext, query);
  }

  @Post()
  @ApiErrors('validation', 'notFound', 'conflict')
  @RequirePermissions('supplier:manage')
  @ApiOperation({ summary: 'Create a supplier' })
  @ApiCreatedResponse({ type: SupplierResponse })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @Body() body: CreateSupplierDto,
  ): Promise<SupplierView> {
    return this.suppliersService.create(orgContext, body);
  }

  @Patch(':id')
  @ApiErrors('validation', 'notFound', 'conflict')
  @RequirePermissions('supplier:manage')
  @ApiOperation({ summary: 'Update a supplier' })
  @ApiOkResponse({ type: SupplierResponse })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
    @Body() body: UpdateSupplierDto,
  ): Promise<SupplierView> {
    return this.suppliersService.update(orgContext, id, body);
  }

  @Delete(':id')
  @ApiErrors('notFound', 'conflict')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Supplier deleted.' })
  @RequirePermissions('supplier:manage')
  @ApiOperation({ summary: 'Delete an unreferenced supplier' })
  async remove(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.suppliersService.remove(orgContext, id);
  }
}
