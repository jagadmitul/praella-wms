import { createZodDto } from 'nestjs-zod';
import {
  adjustStockSchema,
  movementQuerySchema,
  recordMovementSchema,
  setReplenishmentRuleSchema,
  stockLevelQuerySchema,
} from '@wms/contracts';

export class AdjustStockDto extends createZodDto(adjustStockSchema) {}
export class RecordMovementDto extends createZodDto(recordMovementSchema) {}
export class SetReplenishmentRuleDto extends createZodDto(
  setReplenishmentRuleSchema,
) {}
export class StockLevelQueryDto extends createZodDto(stockLevelQuerySchema) {}
export class MovementQueryDto extends createZodDto(movementQuerySchema) {}
