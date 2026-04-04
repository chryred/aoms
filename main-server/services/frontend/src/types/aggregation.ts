export type PeriodType = 'monthly' | 'quarterly' | 'half_year' | 'annual'
export type LlmSeverity = 'normal' | 'warning' | 'critical'

export interface NodeMetrics {
  cpu_avg: number; cpu_max: number; cpu_min: number
  mem_avg: number; mem_max: number
  disk_avg: number; disk_max: number
}
export interface JvmMetrics {
  heap_avg: number; heap_max: number
  gc_count: number; gc_time_avg: number
}
export type MetricsPayload = NodeMetrics | JvmMetrics | Record<string, number>

export interface HourlyAggregation {
  id: number
  system_id: number
  hour_bucket: string
  collector_type: string
  metric_group: string
  metrics_json: string
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  llm_prediction: string | null
  llm_model_used: string | null
  qdrant_point_id: string | null
  created_at: string
}

export interface DailyAggregation {
  id: number
  system_id: number
  day_bucket: string
  collector_type: string
  metric_group: string
  metrics_json: string
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  qdrant_point_id: string | null
  created_at: string
}

export interface WeeklyAggregation {
  id: number
  system_id: number
  week_start: string
  collector_type: string
  metric_group: string
  metrics_json: string
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  qdrant_point_id: string | null
  created_at: string
}

export interface MonthlyAggregation {
  id: number
  system_id: number
  period_start: string
  period_type: PeriodType
  collector_type: string
  metric_group: string
  metrics_json: string
  llm_summary: string | null
  llm_severity: LlmSeverity | null
  llm_trend: string | null
  qdrant_point_id: string | null
  created_at: string
}

export interface TrendAlert {
  id: number
  system_id: number
  hour_bucket: string
  collector_type: string
  metric_group: string
  llm_severity: LlmSeverity
  llm_prediction: string
  llm_summary: string | null
}

export interface ChartDataPoint {
  timestamp: string
  llm_severity?: LlmSeverity | null
  [metric: string]: number | string | null | undefined
}
