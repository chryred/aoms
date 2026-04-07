import { useQuery } from '@tanstack/react-query'
import { collectorConfigApi } from '@/api/collectorConfig'
import { qk } from '@/constants/queryKeys'

export function useCollectorStatus(id: number | null, enabled = true) {
  return useQuery({
    queryKey: qk.collectorStatus(id ?? 0),
    queryFn: () => collectorConfigApi.getStatus(id!),
    enabled: id !== null && enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })
}
