import { useQuery } from '@tanstack/react-query'
import { alertsApi, type AlertCountParams } from '@/api/alerts'
import { qk } from '@/constants/queryKeys'

export function useAlertsCount(params: AlertCountParams = {}) {
  return useQuery({
    queryKey: qk.alertsCount(params),
    queryFn: () => alertsApi.getAlertsCount(params),
    staleTime: 5_000,
    refetchInterval: 30_000,
  })
}
