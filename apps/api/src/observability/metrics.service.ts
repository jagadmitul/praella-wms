import { Injectable } from '@nestjs/common';

/** Upper bounds, in seconds, for the HTTP latency histogram. */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramState {
  buckets: number[];
  sum: number;
  count: number;
}

/**
 * Prometheus metrics, in the text exposition format.
 *
 * Implemented directly rather than via `prom-client` because the surface
 * needed here is one counter and one histogram, and the exposition format is
 * a documented, stable text protocol. Fewer dependencies in the request path
 * of a system that is meant to stay up.
 *
 * Labels are deliberately low-cardinality: the *route template* is recorded,
 * never the concrete path. Using `/products/abc123` as a label would mint a new
 * time series per product and eventually take Prometheus down — the classic
 * cardinality-explosion mistake.
 */
@Injectable()
export class MetricsService {
  private readonly requestCounts = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly businessCounters = new Map<string, number>();
  private readonly startedAt = Date.now();

  /**
   * Records a completed HTTP request.
   *
   * @param method - HTTP method.
   * @param route - Route template, e.g. `/products/:id`.
   * @param statusCode - Response status.
   * @param durationSeconds - Wall-clock duration.
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const key = `${method}|${route}|${statusCode}`;
    this.requestCounts.set(key, (this.requestCounts.get(key) ?? 0) + 1);

    const histogramKey = `${method}|${route}`;
    const state =
      this.histograms.get(histogramKey) ??
      { buckets: new Array<number>(LATENCY_BUCKETS.length).fill(0), sum: 0, count: 0 };

    for (let index = 0; index < LATENCY_BUCKETS.length; index += 1) {
      if (durationSeconds <= LATENCY_BUCKETS[index]!) {
        state.buckets[index] = (state.buckets[index] ?? 0) + 1;
      }
    }

    state.sum += durationSeconds;
    state.count += 1;
    this.histograms.set(histogramKey, state);
  }

  /**
   * Increments a domain counter, e.g. stock movements applied.
   *
   * @param name - Metric name, without the `wms_` prefix.
   * @param labels - Low-cardinality labels.
   * @param by - Amount to add.
   */
  increment(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = `${name}|${JSON.stringify(labels)}`;
    this.businessCounters.set(key, (this.businessCounters.get(key) ?? 0) + by);
  }

  /**
   * Renders every metric in the Prometheus text exposition format.
   *
   * @returns The metrics payload.
   */
  render(): string {
    const lines: string[] = [];

    lines.push(
      '# HELP wms_process_uptime_seconds Seconds since the process started.',
      '# TYPE wms_process_uptime_seconds gauge',
      `wms_process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(0)}`,
      '',
      '# HELP wms_http_requests_total Total HTTP requests handled.',
      '# TYPE wms_http_requests_total counter',
    );

    for (const [key, value] of this.requestCounts) {
      const [method, route, status] = key.split('|');
      lines.push(
        `wms_http_requests_total{method="${method}",route="${escapeLabel(route!)}",status="${status}"} ${value}`,
      );
    }

    lines.push(
      '',
      '# HELP wms_http_request_duration_seconds HTTP request latency.',
      '# TYPE wms_http_request_duration_seconds histogram',
    );

    for (const [key, state] of this.histograms) {
      const [method, route] = key.split('|');
      const labels = `method="${method}",route="${escapeLabel(route!)}"`;

      LATENCY_BUCKETS.forEach((bound, index) => {
        lines.push(
          `wms_http_request_duration_seconds_bucket{${labels},le="${bound}"} ${state.buckets[index] ?? 0}`,
        );
      });

      lines.push(
        `wms_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${state.count}`,
        `wms_http_request_duration_seconds_sum{${labels}} ${state.sum.toFixed(6)}`,
        `wms_http_request_duration_seconds_count{${labels}} ${state.count}`,
      );
    }

    if (this.businessCounters.size > 0) {
      lines.push('', '# HELP wms_domain_events_total Domain events recorded.', '# TYPE wms_domain_events_total counter');

      for (const [key, value] of this.businessCounters) {
        const [name, rawLabels] = key.split('|');
        const labels = JSON.parse(rawLabels!) as Record<string, string>;
        const rendered = Object.entries(labels)
          .map(([label, labelValue]) => `${label}="${escapeLabel(labelValue)}"`)
          .join(',');

        lines.push(
          `wms_domain_events_total{event="${name}"${rendered ? `,${rendered}` : ''}} ${value}`,
        );
      }
    }

    return `${lines.join('\n')}\n`;
  }
}

/** Escapes a Prometheus label value. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
