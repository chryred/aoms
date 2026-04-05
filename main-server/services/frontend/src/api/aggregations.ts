import { adminApi } from '@/lib/ky-client'
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

function filterParams(params: Record<string, string | number | undefined>) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<
    string,
    string | number
  >
}

export const aggregationsApi = {
  getHourly: (params: HourlyParams) =>
    adminApi
      .get('api/v1/aggregations/hourly', {
        searchParams: filterParams(params as Record<string, string | number | undefined>),
      })
      .json<HourlyAggregation[]>(),

  getDaily: (params: { system_id?: number; collector_type?: string }) =>
    adminApi
      .get('api/v1/aggregations/daily', {
        searchParams: filterParams(params as Record<string, string | number | undefined>),
      })
      .json<DailyAggregation[]>(),

  getWeekly: (params: { system_id?: number; collector_type?: string }) =>
    adminApi
      .get('api/v1/aggregations/weekly', {
        searchParams: filterParams(params as Record<string, string | number | undefined>),
      })
      .json<WeeklyAggregation[]>(),

  getMonthly: (params: { system_id?: number; period_type?: PeriodType }) =>
    adminApi
      .get('api/v1/aggregations/monthly', {
        searchParams: filterParams(params as Record<string, string | number | undefined>),
      })
      .json<MonthlyAggregation[]>(),

  getTrendAlerts: () => adminApi.get('api/v1/aggregations/trend-alert').json<TrendAlert[]>(),
}
