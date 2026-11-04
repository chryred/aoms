import { useQueries, useQuery } from '@tanstack/react-query'
import { aggregationsApi, type HourlyParams } from '@/api/aggregations'
import { adminApi } from '@/lib/ky-client'
import { qk } from '@/constants/queryKeys'
import type { PeriodType } from '@/types/aggregation'

interface CollectorConfig {
  id: number
  system_id: number
  collector_type: string
  metric_group: string
  enabled: boolean
}

export function useCollectorConfigs(system_id: number | undefined) {
  return useQuery<CollectorConfig[]>({
    queryKey: ['collectorConfigs', system_id],
    queryFn: () =>
      adminApi
        .get('api/v1/collector-config', { searchParams: { system_id: system_id! } })
        .json<CollectorConfig[]>(),
    enabled: !!system_id,
    staleTime: 300_000,
  })
}

export function useHourlyAggregations(params: HourlyParams) {
  return useQuery({
    queryKey: qk.aggregations.hourly(params),
    queryFn: () => aggregationsApi.getHourly(params),
    staleTime: 3_600_000,
    enabled: true,
  })
}

export function useDailyAggregations(
  params: { system_id?: number; collector_type?: string },
  enabled = true,
) {
  return useQuery({
    queryKey: qk.aggregations.daily(params),
    queryFn: () => aggregationsApi.getDaily(params),
    staleTime: 86_400_000,
    enabled,
  })
}

export function useWeeklyAggregations(params: { system_id?: number }, enabled = true) {
  return useQuery({
    queryKey: qk.aggregations.weekly(params),
    queryFn: () => aggregationsApi.getWeekly(params),
    staleTime: 86_400_000,
    enabled,
  })
}

export function useMonthlyAggregations(
  params: { system_id?: number; period_type?: PeriodType },
  enabled = true,
) {
  return useQuery({
    queryKey: qk.aggregations.monthly(params),
    queryFn: () => aggregationsApi.getMonthly(params),
    staleTime: 86_400_000,
    enabled,
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

export interface MetricsRangeParams {
  system_id: number
  collector_type: string
  metric_group: string
  start_dt: string
  end_dt: string
  step?: number
}

export function useMetricsRange(params: MetricsRangeParams | null) {
  return useQuery({
    queryKey: ['metrics-range', params],
    queryFn: () => aggregationsApi.getMetricsRange(params!),
    enabled: !!params,
    staleTime: 300_000,
    gcTime: 600_000,
  })
}

export function useMetricsLiveSummary(systemId: number | null, collectorType: string | null) {
  return useQuery({
    queryKey: ['metrics-live-summary', systemId, collectorType],
    queryFn: () => aggregationsApi.getMetricsLiveSummary(systemId!, collectorType!),
    enabled: !!systemId && !!collectorType,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useProcessSummary(systemId: number | null) {
  return useQuery({
    queryKey: ['process-summary', systemId],
    queryFn: () => aggregationsApi.getProcessSummary(systemId!),
    enabled: !!systemId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export const HOST_MEM_REFRESH_MS = 30_000

/**
 * 시스템별 호스트 메모리 사용률(%) — synapse_agent live-summary 의 memory 값(시스템 내 최악 호스트, 5분 max).
 * 호스트 IP 단위 조회 API 는 없어서 시스템 단위로만 가져온다. 값이 없으면 null.
 */
export function useSystemsHostMemory(systemIds: number[]): Map<number, number | null> {
  const results = useQueries({
    queries: systemIds.map((id) => ({
      queryKey: ['metrics-live-summary', id, 'synapse_agent'],
      queryFn: () => aggregationsApi.getMetricsLiveSummary(id, 'synapse_agent'),
      refetchInterval: HOST_MEM_REFRESH_MS,
      staleTime: HOST_MEM_REFRESH_MS / 2,
      retry: false,
    })),
  })
  return new Map(
    systemIds.map((id, i) => {
      const v = results[i]?.data?.memory
      return [id, typeof v === 'number' && Number.isFinite(v) ? v : null]
    }),
  )
}
