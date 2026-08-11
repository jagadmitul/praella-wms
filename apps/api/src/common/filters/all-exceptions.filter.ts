import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@wms/contracts';
import { Prisma } from '../../generated/prisma/client';
import type { MaybeAuthenticatedRequest } from '../types/request-context';

/**
 * Translates every thrown error into the single `ApiErrorBody` shape the
 * contracts package publishes, so an integrator never has to branch on where a
 * failure came from.
 *
 * It also stops Prisma's internals leaking outward: a unique-constraint
 * violation becomes a 409 naming the conflicting field, not a 500 with a stack
 * trace and the table's physical column names.
 */
/**
 * `HttpStatus.INTERNAL_SERVER_ERROR` widened to a plain number.
 *
 * Statuses arrive here as numbers from many sources — Nest exceptions, Prisma
 * error mapping, thrown literals — so comparing one against an enum member is
 * a cross-type comparison. Widening once, here, keeps the call site readable.
 */
const SERVER_ERROR_THRESHOLD: number = HttpStatus.INTERNAL_SERVER_ERROR;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<MaybeAuthenticatedRequest>();

    const resolved = this.resolve(exception);

    const body: ApiErrorBody = {
      statusCode: resolved.status,
      error: resolved.error,
      message: resolved.message,
      ...(resolved.details ? { details: resolved.details } : {}),
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
      requestId: request.requestId ?? 'unknown',
    };

    if (resolved.status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `${request.method} ${body.path} → ${resolved.status} ${resolved.message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${body.path} → ${resolved.status} ${resolved.message}`,
      );
    }

    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    error: string;
    message: string;
    details?: ApiErrorBody['details'];
  } {
    if (exception instanceof ZodValidationException) {
      // `getZodError()` is typed as `unknown` by nestjs-zod, so narrow it
      // rather than asserting.
      const zodError = exception.getZodError();
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Validation Failed',
        message: 'The request body or query string failed validation',
        ...(zodError instanceof ZodError
          ? { details: this.formatZodIssues(zodError) }
          : {}),
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Validation Failed',
        message: 'The request body or query string failed validation',
        details: this.formatZodIssues(exception),
      };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ??
            exception.message);

      return {
        status: exception.getStatus(),
        error: this.statusName(exception.getStatus()),
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.resolvePrismaError(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    };
  }

  private resolvePrismaError(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    error: string;
    message: string;
  } {
    const target =
      (exception.meta?.target as string[] | string | undefined) ?? [];
    const fields = Array.isArray(target) ? target.join(', ') : target;

    switch (exception.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: fields
            ? `A record with this ${fields} already exists`
            : 'A record with these details already exists',
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message:
            'This record is referenced by other records and cannot be changed',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'The requested record does not exist',
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: `Database request failed (${exception.code})`,
        };
    }
  }

  private formatZodIssues(error: ZodError): ApiErrorBody['details'] {
    return error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    }));
  }

  private statusName(status: number): string {
    const name = Object.entries(HttpStatus).find(
      ([, value]) => (value as unknown as number) === status,
    )?.[0];
    return name
      ? name
          .toLowerCase()
          .split('_')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
      : 'Error';
  }
}
