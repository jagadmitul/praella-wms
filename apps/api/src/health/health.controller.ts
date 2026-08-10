import { Controller, Get, Inject, Optional, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../cache/redis.constants';
import { Public } from '../common/decorators';

/**
 * Liveness and readiness probes.
 *
 * `/health` answers "is the process up?" and never touches a dependency, so a
 * database blip cannot cause an orchestrator to kill an otherwise healthy pod.
 * `/health/ready` answers "can it serve traffic?" and does check dependencies.
 *
 * Version-neutral and excluded from the global prefix, so the probes live at a
 * stable `/health` rather than moving to `/api/v2/health` the day the API is
 * versioned up — a load balancer should never need redeploying for that.
 */
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — checks PostgreSQL and Redis' })
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.checkRedis(),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch (error: unknown) {
      return {
        database: {
          status: 'down',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    if (!this.redis) {
      // Disabled on purpose is not the same as broken.
      return { redis: { status: 'up', message: 'disabled' } };
    }

    try {
      const response = await this.redis.ping();
      return { redis: { status: response === 'PONG' ? 'up' : 'down' } };
    } catch (error: unknown) {
      return {
        redis: {
          status: 'down',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
