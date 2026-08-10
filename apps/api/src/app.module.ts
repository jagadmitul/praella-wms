import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { validateEnv } from './config/env.config';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { CacheModule } from './cache/cache.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { InvitationsModule } from './invitations/invitations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { ProductsModule } from './products/products.module';
import { StockModule } from './stock/stock.module';
import { TransfersModule } from './transfers/transfers.module';
import { OrdersModule } from './orders/orders.module';
import { ReportsModule } from './reports/reports.module';
import { ExportsModule } from './exports/exports.module';
import { JobsModule } from './jobs/jobs.module';
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OrgContextGuard } from './common/guards/org-context.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

/**
 * Queues need Redis. When it is switched off the jobs module is left out
 * entirely rather than registering a queue that could never drain — read
 * directly from `process.env` because module metadata is evaluated before
 * `ConfigModule` has been instantiated.
 */
const queueModules = process.env.REDIS_ENABLED === 'false' ? [] : [JobsModule];

/**
 * Root module.
 *
 * The three security guards are registered globally and run in declaration
 * order — authenticate, resolve the organisation, then check permissions. That
 * ordering matters: `PermissionsGuard` needs the org context that
 * `OrgContextGuard` attaches, which in turn needs the user that `JwtAuthGuard`
 * attaches. Registering them globally means a new endpoint is locked down by
 * default and has to opt out explicitly.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.getOrThrow<number>('THROTTLE_TTL') * 1_000,
            limit: configService.getOrThrow<number>('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),
    ObservabilityModule,
    PrismaModule,
    CommonModule,
    CacheModule,
    NotificationsModule,
    AuthModule,
    OrganizationsModule,
    InvitationsModule,
    WarehousesModule,
    CatalogueModule,
    ProductsModule,
    StockModule,
    TransfersModule,
    OrdersModule,
    ReportsModule,
    ExportsModule,
    HealthModule,
    ...queueModules,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: OrgContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
