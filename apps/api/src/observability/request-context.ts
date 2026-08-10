import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request values carried implicitly through the async call tree. */
export interface RequestScope {
  requestId: string;
  organizationId?: string;
  userId?: string;
}

/**
 * Async-local storage for the current request.
 *
 * This is what lets a log line written deep inside a service carry the same
 * correlation id as the HTTP response, without threading a context object
 * through every function signature between them. It is also the seam an
 * OpenTelemetry exporter would read to attach span attributes.
 */
export const requestContext = new AsyncLocalStorage<RequestScope>();

/** Returns the id of the request currently being handled, if any. */
export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/** Returns the full scope of the request currently being handled, if any. */
export function currentScope(): RequestScope | undefined {
  return requestContext.getStore();
}
