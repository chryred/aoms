export type SchedulerType =
  | 'analysis'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'longperiod'
  | 'trend'

export interface SchedulerRun {
  id: number
  scheduler_type: SchedulerType
  started_at: string
  finished_at: string
  status: 'ok' | 'error'
  error_count: number
  analyzed_count: number
  summary_json: Record<string, unknown> | null
  error_message: string | null
  created_at: string
}
