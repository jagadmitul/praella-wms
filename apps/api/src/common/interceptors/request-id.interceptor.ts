import { randomUUID } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { type Observable, tap } from 'rxjs';
import type { MaybeAuthenticatedRequest } from '../types/request-context';

/**
 * Stamps every request with a correlation id, echoes it back as `x-request-id`,
 * and logs the completed request with its duration. The same id appears in
 * error bodies, so a user-reported failure can be traced to one log line.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

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

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response.statusCode, startedAt),
        error: () => this.log(request, response.statusCode, startedAt),
      }),
    );
  }

  private log(
    request: MaybeAuthenticatedRequest,
    statusCode: number,
    startedAt: bigint,
  ): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.logger.log(
      `${request.method} ${request.originalUrl ?? request.url} ${statusCode} ${durationMs.toFixed(1)}ms`,
    );
  }
}
