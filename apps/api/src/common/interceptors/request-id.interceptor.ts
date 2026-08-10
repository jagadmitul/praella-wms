import { randomUUID } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '../../observability/metrics.service';
import { requestContext } from '../../observability/request-context';
import type { MaybeAuthenticatedRequest } from '../types/request-context';

/**
 * Correlation, logging and metrics for every request.
 *
 * Three things happen here, all of which want the same wrapper:
 *
 *  * a correlation id is minted (or taken from an upstream `x-request-id`),
 *    echoed on the response and pushed into async-local storage so every log
 *    line written while handling the request carries it;
 *  * the completed request is logged with its duration;
 *  * the request is recorded against the Prometheus histogram, labelled with
 *    the *route template* rather than the concrete path, so a per-id URL cannot
 *    explode metric cardinality.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<MaybeAuthenticatedRequest>();
    const response = httpContext.getResponse<Response>();

    const incoming = request.headers['x-request-id'];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);

    const startedAt = process.hrtime.bigint();

    // Wrapping the downstream handler in the async-local store is what makes
    // the id available to code that never sees the request object.
    return new Observable((subscriber) => {
      requestContext.run({ requestId }, () => {
        next
          .handle()
          .pipe(
            tap({
              next: () => this.finish(request, response, startedAt),
              error: () => this.finish(request, response, startedAt),
            }),
          )
          .subscribe(subscriber);
      });
    });
  }

  private finish(
    request: MaybeAuthenticatedRequest,
    response: Response,
    startedAt: bigint,
  ): void {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const path = request.originalUrl ?? request.url;

    // `route.path` is the template (`/products/:id`); `originalUrl` is not.
    const template =
      (request as { route?: { path?: string } }).route?.path ?? stripIds(path);

    const scope = requestContext.getStore();
    if (scope && request.orgContext) {
      scope.organizationId = request.orgContext.organizationId;
      scope.userId = request.user?.id;
    }

    this.metrics.recordHttpRequest(
      request.method,
      template,
      response.statusCode,
      durationSeconds,
    );

    this.logger.log(
      `${request.method} ${path} ${response.statusCode} ${(durationSeconds * 1000).toFixed(1)}ms`,
    );
  }
}

/**
 * Fallback route template for requests Nest could not match to a handler.
 * Replaces anything that looks like an identifier so 404 traffic cannot mint
 * unbounded metric labels.
 */
function stripIds(path: string): string {
  return path
    .split('?')[0]!
    .replace(/\/[0-9a-z]{20,}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}
