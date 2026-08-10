import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BulkStockProcessor } from './bulk-stock.processor';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { BULK_STOCK_QUEUE } from './jobs.constants';

/**
 * Background processing.
 *
 * This module is only imported by `AppModule` when `REDIS_ENABLED=true`. That
 * keeps the "no Redis" mode honest: rather than registering a queue that can
 * never drain, the `/jobs` routes simply do not exist, and every other part of
 * the API keeps working.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          db: configService.get<number>('REDIS_DB') ?? 0,
        },
      }),
    }),
    BullModule.registerQueue({ name: BULK_STOCK_QUEUE }),
  ],
  controllers: [JobsController],
  providers: [JobsService, BulkStockProcessor],
  exports: [JobsService],
})
export class JobsModule {}
