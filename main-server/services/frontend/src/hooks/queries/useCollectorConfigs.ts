import { useQuery } from '@tanstack/react-query'
import { collectorConfigApi, type CollectorConfigFilterParams } from '@/api/collectorConfig'
import { qk } from '@/constants/queryKeys'

export function useCollectorConfigs(params?: CollectorConfigFilterParams) {
  return useQuery({
    queryKey: qk.collectorConfigs(params),
    queryFn: () => collectorConfigApi.getConfigs(params),
    staleTime: 60_000,
  })
}
