import { trace } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

/**
 * Distributed tracing.
 *
 * Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set. That default matters: the
 * auto-instrumentations patch http, pg and ioredis at require time, and paying
 * that cost — plus a background exporter retrying against a collector that
 * isn't there — is the wrong default for a demo someone runs locally.
 *
 * Point it at any OTLP-compatible backend (Jaeger, Tempo, Honeycomb, Datadog)
 * and HTTP requests, Postgres queries and Redis commands are traced with no
 * further code. Spans automatically carry the request's correlation id, so a
 * trace and a log line can be joined on the same value the caller saw in the
 * `x-request-id` header.
 */

// Returns a promise rather than being `async`: nothing here awaits, and the
// promise-returning signature leaves room for an exporter that does.
export function startTracing(): Promise<NodeSDK | null> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) {
    return Promise.resolve(null);
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'wms-api',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '1.0.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noisy and of no diagnostic value here.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  return Promise.resolve(sdk);
}

/**
 * Attaches the request's correlation id to the active span.
 *
 * This is the join between the three observability signals: the same id appears
 * in the response header, in every JSON log line for that request, and now as a
 * span attribute — so a slow trace can be taken straight to its logs.
 *
 * @param requestId - Correlation id for the current request.
 * @param attributes - Any further low-cardinality attributes to record.
 */
export function annotateSpan(
  requestId: string,
  attributes: Record<string, string | number> = {},
): void {
  const span = trace.getActiveSpan();

  if (!span) return;

  span.setAttribute('wms.request_id', requestId);

  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}
