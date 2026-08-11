import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma client bound to the Nest lifecycle.
 *
 * Prisma 7 removed the bundled Rust query engine, so the connection is owned by
 * a `pg` driver adapter. That is a feature rather than a chore: the pool is now
 * explicit and tunable, which is what you want in front of a warehouse workload
 * where a handful of long transactions must not starve the read traffic.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');

    super({
      adapter: new PrismaPg({
        connectionString,
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      }),
      log:
        configService.get<string>('NODE_ENV') === 'development'
          ? [
              { emit: 'event', level: 'warn' },
              { emit: 'event', level: 'error' },
            ]
          : [{ emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Deletes every row in dependency order. Used only by the integration test
   * harness between specs; refuses to run outside `NODE_ENV=test` so it can
   * never be reached from a running server.
   */
  async truncateAllTables(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        'truncateAllTables() is only available when NODE_ENV=test',
      );
    }

    await this.$executeRawUnsafe(`
      TRUNCATE TABLE
        audit_logs, bulk_jobs, document_counters,
        sales_order_items, sales_orders,
        purchase_order_items, purchase_orders,
        stock_transfer_items, stock_transfers,
        stock_movements, stock_levels,
        products, suppliers, categories,
        warehouse_members, warehouses,
        refresh_tokens, memberships,
        organizations, users
      RESTART IDENTITY CASCADE;
    `);
  }
}
