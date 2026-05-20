import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/ky-client'

export interface RealErrorDataPoint {
  timestamp: string
  real_error: number
  notification: number
}

async function fetchRealErrorSeries(
  systemId: number,
  hours: number,
  stepMinutes: number,
): Promise<RealErrorDataPoint[]> {
  return adminApi
    .get('api/v1/analysis/real-error-series', {
      searchParams: { system_id: systemId, hours, step_minutes: stepMinutes },
    })
    .json<RealErrorDataPoint[]>()
}

export function useRealErrorSeries(systemId: number | undefined, hours = 24, stepMinutes = 5) {
  return useQuery({
    queryKey: ['real-error-series', systemId, hours, stepMinutes],
    queryFn: () => fetchRealErrorSeries(systemId!, hours, stepMinutes),
    enabled: !!systemId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}
