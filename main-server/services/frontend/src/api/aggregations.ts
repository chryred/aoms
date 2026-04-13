import { adminApi, filterParams as fp } from '@/lib/ky-client'
import type {
  HourlyAggregation,
  DailyAggregation,
  WeeklyAggregation,
  MonthlyAggregation,
  TrendAlert,
  PeriodType,
} from '@/types/aggregation'

export interface HourlyParams {
  system_id?: number
  collector_type?: string
  metric_group?: string
  severity?: string
  from_dt?: string
  to_dt?: string
}

export const aggregationsApi = {
  getHourly: (params: HourlyParams) =>
    adminApi
      .get('api/v1/aggregations/hourly', { searchParams: fp(params) })
      .json<HourlyAggregation[]>(),

  getDaily: (params: { system_id?: number; collector_type?: string }) =>
    adminApi
      .get('api/v1/aggregations/daily', { searchParams: fp(params) })
      .json<DailyAggregation[]>(),

  getWeekly: (params: { system_id?: number; collector_type?: string }) =>
    adminApi
      .get('api/v1/aggregations/weekly', { searchParams: fp(params) })
      .json<WeeklyAggregation[]>(),

  getMonthly: (params: { system_id?: number; period_type?: PeriodType }) =>
    adminApi
      .get('api/v1/aggregations/monthly', { searchParams: fp(params) })
      .json<MonthlyAggregation[]>(),

  getTrendAlerts: () => adminApi.get('api/v1/aggregations/trend-alert').json<TrendAlert[]>(),

  getMetricsRange: (params: {
    system_id: number
    collector_type: string
    metric_group: string
    start_dt: string
    end_dt: string
    step?: number
  }) =>
    adminApi
      .get(`api/v1/systems/${params.system_id}/metrics/range`, {
        searchParams: fp({
          collector_type: params.collector_type,
          metric_group: params.metric_group,
          start_dt: params.start_dt,
          end_dt: params.end_dt,
          step: params.step ?? 60,
        }),
      })
      .json<HourlyAggregation[]>(),

  getMetricsLiveSummary: (systemId: number, collectorType: string) =>
    adminApi
      .get(`api/v1/systems/${systemId}/metrics/live-summary`, {
        searchParams: fp({ collector_type: collectorType }),
      })
      .json<Record<string, number | null>>(),

  getProcessSummary: (systemId: number) =>
    adminApi.get(`api/v1/systems/${systemId}/metrics/process-summary`).json<ProcessSummary[]>(),
}

export interface ProcessSummary {
  name: string
  cpu_percent: number
  mem_percent: number
  mem_bytes: number
}
