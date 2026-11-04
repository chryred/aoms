import { useQuery } from '@tanstack/react-query'
import { useTabActive } from '@/components/layout/tabs/TabContext'
import { alertsApi, type AlertFilterParams } from '@/api/alerts'
import { qk } from '@/constants/queryKeys'

export function useAlerts(params: AlertFilterParams = {}) {
  const active = useTabActive()
  return useQuery({
    queryKey: qk.alerts(params),
    queryFn: () => alertsApi.getAlerts(params),
    staleTime: 5_000,
    refetchInterval: active ? 30_000 : false,
  })
}
