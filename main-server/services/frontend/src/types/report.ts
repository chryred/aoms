import type { DailyAggregation, LlmSeverity, WeeklyAggregation, MonthlyAggregation } from './aggregation'

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_year' | 'annual'
export type TeamsStatus = 'sent' | 'failed'

export interface ReportHistory {
  id: number
  report_type: ReportType
  period_start: string
  period_end: string
  sent_at: string
  teams_status: TeamsStatus | null
  llm_summary: string | null
  system_count: number | null
}

export interface ReportPeriodSummary {
  periodType: ReportType
  systemSummaries: SystemPeriodSummary[]
}

export interface SystemPeriodSummary {
  system_id: number
  system_name: string
  display_name: string
  aggregations: (DailyAggregation | WeeklyAggregation | MonthlyAggregation)[]
  worstSeverity: LlmSeverity
}
