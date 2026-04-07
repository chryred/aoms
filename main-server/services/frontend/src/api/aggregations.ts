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
}
