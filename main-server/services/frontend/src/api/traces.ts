import { adminApi, filterParams } from '@/lib/ky-client'

export interface TraceSearchParams {
  q?: string
  start?: string
  end?: string
  limit?: number
  offset?: number
}

export interface TraceItem {
  traceID: string
  rootTraceName: string | null
  rootServiceName: string | null
  startTimeUnixNano: string
  durationMs: number
  spanSets?: SpanSet[]
}

export interface SpanSet {
  spans: Span[]
  matched: number
}

export interface Span {
  spanID: string
  startTimeUnixNano: string
  durationNanos: string
  attributes?: Record<string, unknown>[]
}

export interface TraceSearchResult {
  traces: TraceItem[]
  metrics: {
    inspectedTraces?: number
    inspectedBytes?: string
  }
}

export interface TraceDetail {
  batches: unknown[]
}

export interface TraceDotPoint {
  ts: number
  durationMs: number
  traceID: string
  error: boolean
  slow: boolean
  name: string | null
}

export interface TraceMetrics {
  window_minutes: number
  total: number
  error_count: number
  slow_count: number
  anomaly_count: number
  slow_threshold_ms: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  dots: TraceDotPoint[]
}

export const tracesApi = {
  searchTraces: (systemId: number, params: TraceSearchParams = {}) =>
    adminApi
      .get(`api/v1/systems/${systemId}/traces/search`, { searchParams: filterParams(params) })
      .json<TraceSearchResult>(),

  getTrace: (traceId: string) => adminApi.get(`api/v1/traces/${traceId}`).json<TraceDetail>(),

  getTraceMetrics: (systemId: number, windowMinutes?: number) =>
    adminApi
      .get(`api/v1/systems/${systemId}/traces/metrics`, {
        searchParams: filterParams({ window_minutes: windowMinutes }),
      })
      .json<TraceMetrics>(),
}
