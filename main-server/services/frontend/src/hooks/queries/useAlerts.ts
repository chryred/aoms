import { useQuery } from '@tanstack/react-query'
import { alertsApi, type AlertFilterParams } from '@/api/alerts'
import { qk } from '@/constants/queryKeys'

export function useAlerts(params: AlertFilterParams = {}) {
  return useQuery({
    queryKey: qk.alerts(params),
    queryFn: () => alertsApi.getAlerts(params),
    staleTime: 5_000,
    refetchInterval: 30_000,
  })
}
