import { ConsoleLogger, type LogLevel } from '@nestjs/common';

/**
 * Structured JSON logger.
 *
 * In production every line is a single JSON object, because log aggregators
 * (Loki, Datadog, CloudWatch) index fields, not prose — and a multi-line
 * pretty-printed stack trace becomes several unrelated log entries once it is
 * shipped. In development it falls back to Nest's readable console format,
 * since a human is reading it directly.
 *
 * `requestId` is attached by the async-local context, so every line emitted
 * while handling a request carries the same correlation id as the response
 * header and any error body the caller received.
 */
export class JsonLogger extends ConsoleLogger {
  private readonly asJson: boolean;

  constructor() {
    super();
    this.asJson =
      process.env.LOG_FORMAT === 'json' ||
      process.env.NODE_ENV === 'production';
  }

  /** Correlation id for the request currently being handled, if any. */
  private static currentRequestId: (() => string | undefined) | null = null;

  /**
   * Registers the accessor used to stamp log lines with a request id.
   *
   * @param accessor - Returns the active request id, or `undefined`.
   */
  static bindRequestContext(accessor: () => string | undefined): void {
    JsonLogger.currentRequestId = accessor;
  }

  override log(message: unknown, ...rest: unknown[]): void {
    this.emit('info', message, rest);
  }

  override error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }

  override debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }

  override verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('verbose', message, rest);
  }

  private emit(
    level: LogLevel | 'info',
    message: unknown,
    rest: unknown[],
  ): void {
    if (!this.asJson) {
      switch (level) {
        case 'error':
          super.error(message, ...(rest as []));
          return;
        case 'warn':
          super.warn(message, ...(rest as []));
          return;
        case 'debug':
          super.debug(message, ...(rest as []));
          return;
        case 'verbose':
          super.verbose(message, ...(rest as []));
          return;
        default:
          super.log(message, ...(rest as []));
          return;
      }
    }

    // Nest passes the context as the last string argument; anything else is
    // supplementary detail such as a stack trace.
    const context =
      typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const detail = context ? rest.slice(0, -1) : rest;

    const line: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      ...(context ? { context } : {}),
      ...(detail.length > 0 ? { detail: detail.map(String) } : {}),
    };

    const requestId = JsonLogger.currentRequestId?.();
    if (requestId) {
      line.requestId = requestId;
    }

    process.stdout.write(`${JSON.stringify(line)}\n`);
  }
}
