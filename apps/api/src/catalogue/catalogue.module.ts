import { Module } from '@nestjs/common';
import {
  CategoriesController,
  SuppliersController,
} from './catalogue.controller';
import { CategoriesService } from './categories.service';
import { SuppliersService } from './suppliers.service';

/** Reference data that products hang off: categories and suppliers. */
@Module({
  controllers: [CategoriesController, SuppliersController],
  providers: [CategoriesService, SuppliersService],
  exports: [CategoriesService, SuppliersService],
})
export class CatalogueModule {}
