import { createZodDto } from 'nestjs-zod';
import { createTransferSchema, transferQuerySchema } from '@wms/contracts';

export class CreateTransferDto extends createZodDto(createTransferSchema) {}
export class TransferQueryDto extends createZodDto(transferQuerySchema) {}
