import 'server-only';
import { redirect } from 'next/navigation';
import type { ApiErrorBody } from '@wms/contracts';
import { getAccessToken, getActiveOrganizationId } from './session';

/** Base URL of the REST API, without a trailing slash. */
export const API_BASE_URL = (
  process.env.API_BASE_URL ?? 'http://localhost:4300/api/v1'
).replace(/\/$/, '');

/** Thrown when the API responds with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ApiErrorBody['details'],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Statuses a sleeping or restarting container returns while it wakes up. */
const COLD_START_STATUSES = new Set([502, 503, 504]);

/** How long to wait before each retry. */
const RETRY_BACKOFF_MS = [1_000, 3_000, 6_000];

/**
 * Fetches with a bounded retry for the cold-start window.
 *
 * The API runs on a free container that is suspended after a period of
 * inactivity; the first request in then waits ~30-50s for a boot and comes back
 * as a 502/503 or a socket error. Without this, the first visit after a quiet
 * hour renders Next.js's error page even though nothing is actually broken.
 *
 * Only retried for reads. Replaying a POST that timed out mid-flight could
 * receive the same goods twice, and no amount of convenience is worth a
 * duplicated stock movement.
 *
 * @param url - Absolute URL to call.
 * @param init - Fetch options, including Next.js cache directives.
 * @param retryable - Whether the request is safe to replay.
 * @returns The final response, successful or not.
 */
async function fetchWithColdStartRetry(
  url: string,
  init: RequestInit & { next?: { tags?: string[]; revalidate?: number | false } },
  retryable: boolean,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= (retryable ? RETRY_BACKOFF_MS.length : 0); attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS[attempt - 1]));
    }

    try {
      const response = await fetch(url, init);
      if (!retryable || !COLD_START_STATUSES.has(response.status)) {
        return response;
      }
      lastError = new ApiError(response.status, 'Upstream unavailable');
    } catch (error: unknown) {
      // A refused connection or aborted socket during boot looks like this.
      lastError = error;
      if (!retryable) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiError(503, 'The API did not respond');
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Next.js cache tags so a mutation can revalidate exactly what it changed. */
  tags?: string[];
  /** Seconds to cache the response. Defaults to no caching. */
  revalidate?: number | false;
}

/**
 * Calls the API on behalf of the signed-in user.
 *
 * Runs only on the server, so the bearer token never reaches the browser. A
 * 401 here means the middleware's refresh attempt has already failed, so the
 * visitor is sent back to sign in rather than being shown a broken page.
 *
 * @param path - Path below the API base, e.g. `/warehouses`.
 * @param options - Method, body and caching behaviour.
 * @returns The parsed response body.
 * @throws ApiError for any non-2xx response other than 401.
 */
export async function apiFetch<TResponse>(
  path: string,
  options: RequestOptions = {},
): Promise<TResponse> {
  const [accessToken, organizationId] = await Promise.all([
    getAccessToken(),
    getActiveOrganizationId(),
  ]);

  if (!accessToken) {
    redirect('/login');
  }

  const method = options.method ?? 'GET';
  const response = await fetchWithColdStartRetry(
    `${API_BASE_URL}${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(organizationId ? { 'x-organization-id': organizationId } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      next: {
        ...(options.tags ? { tags: options.tags } : {}),
        revalidate: options.revalidate ?? 0,
      },
    },
    method === 'GET',
  );

  if (response.status === 401) {
    redirect('/login?reason=expired');
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const payload = (await response.json().catch(() => null)) as
    | (ApiErrorBody & TResponse)
    | null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message ?? `Request failed with status ${response.status}`,
      payload?.details,
    );
  }

  return payload as TResponse;
}

/**
 * Builds a query string from a record, dropping empty values so the API never
 * receives `?search=&page=`.
 *
 * @param params - Query parameters, possibly containing empty values.
 * @returns A query string beginning with `?`, or an empty string.
 */
export function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || value === null) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}
