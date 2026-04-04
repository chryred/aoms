// POST /aggregation/search 요청 본문
export interface SimilarSearchRequest {
  query_text: string
  collection: string        // "metric_hourly_patterns" | "aggregation_summaries"
  system_id?: number
  limit?: number
  score_threshold?: number  // 기본 0.70 (0.5 ~ 1.0)
}

// metric_hourly_patterns payload 구조
export interface HourlyPatternPayload {
  system_id: number
  system_name: string
  hour_bucket: string       // ISO 8601 UTC
  collector_type: string
  metric_group: string
  summary_text: string
  llm_severity: string      // "normal" | "warning" | "critical"
  llm_trend: string | null
  llm_prediction: string | null
  pg_row_id: number
  stored_at: string
}

// aggregation_summaries payload 구조
export interface AggSummaryPayload {
  system_id: number
  system_name: string
  period_type: string       // "daily" | "weekly" | "monthly" | "quarterly" | "half_year" | "annual"
  period_start: string      // ISO 8601 UTC
  summary_text: string
  dominant_severity: string // "normal" | "warning" | "critical"
  pg_row_id: number
  stored_at: string
}

export type SearchResultPayload = HourlyPatternPayload | AggSummaryPayload

export interface SimilarSearchResult {
  id: string
  score: number
  payload: SearchResultPayload
}

export interface SimilarSearchResponse {
  count: number
  results: SimilarSearchResult[]
}

export interface CollectionStatus {
  points_count: number
  vectors_count: number
  status: string   // "green" | "yellow" | "red" | "not_found" | "error"
}

export interface CollectionsInfo {
  metric_hourly_patterns: CollectionStatus
  aggregation_summaries: CollectionStatus
}

export interface SearchParams {
  q: string
  threshold: number
  collection: string
}

// GET /aggregation/status 응답 — WF6~WF11 파이프라인 실행 상태
export interface AggregationPipelineStatus {
  running: boolean
  last_run: string | null      // ISO 8601 UTC
  last_status: string | null   // "ok" | "error" | null
  error_message: string | null
}

export type AggregationPipelineKey = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'longperiod' | 'trend'

export type AggregationStatusResponse = Record<AggregationPipelineKey, AggregationPipelineStatus>
