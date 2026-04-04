import { useQuery } from '@tanstack/react-query'
import { aggregationsApi, type HourlyParams } from '@/api/aggregations'
import { qk } from '@/constants/queryKeys'
import type { PeriodType } from '@/types/aggregation'

export function useHourlyAggregations(params: HourlyParams) {
  return useQuery({
    queryKey: qk.aggregations.hourly(params),
    queryFn: () => aggregationsApi.getHourly(params),
    staleTime: 3_600_000,
    enabled: !!params.system_id,
  })
}

export function useDailyAggregations(params: { system_id?: number; collector_type?: string }) {
  return useQuery({
    queryKey: qk.aggregations.daily(params),
    queryFn: () => aggregationsApi.getDaily(params),
    staleTime: 86_400_000,
  })
}

export function useWeeklyAggregations(params: { system_id?: number }) {
  return useQuery({
    queryKey: qk.aggregations.weekly(params),
    queryFn: () => aggregationsApi.getWeekly(params),
    staleTime: 86_400_000,
  })
}

export function useMonthlyAggregations(params: { system_id?: number; period_type?: PeriodType }) {
  return useQuery({
    queryKey: qk.aggregations.monthly(params),
    queryFn: () => aggregationsApi.getMonthly(params),
    staleTime: 86_400_000,
  })
}

export function useTrendAlerts() {
  return useQuery({
    queryKey: qk.aggregations.trends(),
    queryFn: () => aggregationsApi.getTrendAlerts(),
    staleTime: 30_000,
    refetchInterval: 300_000,
  })
}
