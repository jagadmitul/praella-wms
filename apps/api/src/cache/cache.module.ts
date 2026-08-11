import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Provides the shared Redis connection used by the cache. The provider yields
 * `null` when `REDIS_ENABLED=false`, which lets the whole application run
 * against Postgres alone — useful for a reviewer who would rather not start a
 * second container.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis | null => {
        const logger = new Logger('RedisClient');

        if (!configService.get<boolean>('REDIS_ENABLED')) {
          logger.warn(
            'REDIS_ENABLED=false — caching and background queues are disabled',
          );
          return null;
        }

        const client = new Redis({
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          db: configService.get<number>('REDIS_DB') ?? 0,
          maxRetriesPerRequest: 2,
          lazyConnect: false,
          retryStrategy: (times) => Math.min(times * 200, 3_000),
        });

        client.on('error', (error: Error) => {
          // Logged rather than thrown: the cache is an optimisation, and an
          // unhandled 'error' event would otherwise take the process down.
          logger.warn(`Redis connection error: ${error.message}`);
        });
        client.on('connect', () => logger.log('Connected to Redis'));

        return client;
      },
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class CacheModule {}
