import {
  Controller,
  Get,
  Global,
  Header,
  Module,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint.
 *
 * Left unauthenticated because a scraper is not a user and has no token, which
 * is the norm for `/metrics`. In a real deployment it would be bound to an
 * internal network or protected at the ingress rather than in application code
 * — the metrics themselves contain no tenant data, only route templates and
 * counts.
 */
@ApiTags('Observability')
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics' })
  @ApiExcludeEndpoint()
  scrape(): string {
    return this.metricsService.render();
  }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
