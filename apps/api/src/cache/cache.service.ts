import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Read-through cache for expensive, frequently-read aggregates such as the
 * dashboard summary and the low-stock report.
 *
 * Invalidation is by tenant-scoped prefix rather than by individual key. A
 * stock movement can change the dashboard, the low-stock list and several
 * product rows at once, so enumerating the affected keys would be both fiddly
 * and easy to get wrong; dropping `wms:<orgId>:*` is one call and cannot leave
 * a stale entry behind.
 *
 * The whole service degrades to a no-op when Redis is disabled, so the API
 * still runs end-to-end with `REDIS_ENABLED=false` and no Redis available.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    this.defaultTtlSeconds =
      this.configService.get<number>('CACHE_TTL_SECONDS') ?? 60;
  }

  /** Whether a Redis connection is available for this process. */
  get isEnabled(): boolean {
    return this.redis !== null;
  }

  /**
   * Namespaces a cache key to one organisation.
   *
   * @param organizationId - Tenant the key belongs to.
   * @param parts - Key segments, e.g. `['dashboard']` or `['products', hash]`.
   * @returns The fully-qualified cache key.
   */
  buildKey(organizationId: string, ...parts: string[]): string {
    return `wms:${organizationId}:${parts.join(':')}`;
  }

  /**
   * Returns a cached value, or computes, stores and returns it on a miss.
   *
   * A cache failure is never fatal: if Redis is unreachable the factory simply
   * runs, so a Redis outage degrades latency rather than availability.
   *
   * @param key - Fully-qualified cache key from `buildKey`.
   * @param factory - Produces the value when it is not cached.
   * @param ttlSeconds - Lifetime override in seconds.
   * @returns The cached or freshly computed value.
   */
  async remember<TValue>(
    key: string,
    factory: () => Promise<TValue>,
    ttlSeconds?: number,
  ): Promise<TValue> {
    if (!this.redis) {
      return factory();
    }

    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as TValue;
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Cache read failed for "${key}": ${this.describe(error)}`,
      );
      return factory();
    }

    const value = await factory();

    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        ttlSeconds ?? this.defaultTtlSeconds,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Cache write failed for "${key}": ${this.describe(error)}`,
      );
    }

    return value;
  }

  /**
   * Drops every cached entry belonging to one organisation.
   *
   * Uses `SCAN` rather than `KEYS` so invalidation never blocks the Redis event
   * loop on a large keyspace.
   *
   * @param organizationId - Tenant whose cache should be cleared.
   */
  async invalidateOrganization(organizationId: string): Promise<void> {
    if (!this.redis) {
      return;
    }

    const pattern = `wms:${organizationId}:*`;

    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          200,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error: unknown) {
      this.logger.warn(
        `Cache invalidation failed for "${pattern}": ${this.describe(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
