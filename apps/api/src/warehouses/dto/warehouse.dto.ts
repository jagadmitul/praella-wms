import { createZodDto } from 'nestjs-zod';
import {
  assignWarehouseMembersSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  warehouseQuerySchema,
} from '@wms/contracts';

export class CreateWarehouseDto extends createZodDto(createWarehouseSchema) {}
export class UpdateWarehouseDto extends createZodDto(updateWarehouseSchema) {}
export class WarehouseQueryDto extends createZodDto(warehouseQuerySchema) {}
export class AssignWarehouseMembersDto extends createZodDto(
  assignWarehouseMembersSchema,
) {}
