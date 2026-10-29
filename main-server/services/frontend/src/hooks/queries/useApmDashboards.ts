import { useQuery } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'

export function useApmDashboards() {
  return useQuery({
    queryKey: qk.apm.dashboards(),
    queryFn: () => apmApi.listDashboards(),
    staleTime: 60_000,
  })
}
