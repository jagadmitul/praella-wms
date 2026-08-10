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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CategoryView, Paginated, SupplierView } from '@wms/contracts';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
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
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: CatalogueQueryDto,
  ): Promise<Paginated<CategoryView>> {
    return this.categoriesService.list(orgContext, query);
  }

  @Post()
  @RequirePermissions('category:manage')
  @ApiOperation({ summary: 'Create a category' })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @Body() body: CreateCategoryDto,
  ): Promise<CategoryView> {
    return this.categoriesService.create(orgContext, body);
  }

  @Patch(':id')
  @RequirePermissions('category:manage')
  @ApiOperation({ summary: 'Update a category' })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
    @Body() body: UpdateCategoryDto,
  ): Promise<CategoryView> {
    return this.categoriesService.update(orgContext, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
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
  async list(
    @CurrentOrg() orgContext: OrgContext,
    @Query() query: CatalogueQueryDto,
  ): Promise<Paginated<SupplierView>> {
    return this.suppliersService.list(orgContext, query);
  }

  @Post()
  @RequirePermissions('supplier:manage')
  @ApiOperation({ summary: 'Create a supplier' })
  async create(
    @CurrentOrg() orgContext: OrgContext,
    @Body() body: CreateSupplierDto,
  ): Promise<SupplierView> {
    return this.suppliersService.create(orgContext, body);
  }

  @Patch(':id')
  @RequirePermissions('supplier:manage')
  @ApiOperation({ summary: 'Update a supplier' })
  async update(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
    @Body() body: UpdateSupplierDto,
  ): Promise<SupplierView> {
    return this.suppliersService.update(orgContext, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('supplier:manage')
  @ApiOperation({ summary: 'Delete an unreferenced supplier' })
  async remove(
    @CurrentOrg() orgContext: OrgContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.suppliersService.remove(orgContext, id);
  }
}
