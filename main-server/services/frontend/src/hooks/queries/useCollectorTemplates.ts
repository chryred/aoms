import { useQuery } from '@tanstack/react-query'
import { collectorConfigApi } from '@/api/collectorConfig'
import { qk } from '@/constants/queryKeys'
import type { CollectorType } from '@/types/collectorConfig'

export function useCollectorTemplates(type: CollectorType | null) {
  return useQuery({
    queryKey: qk.collectorTemplates(type!),
    queryFn: () => collectorConfigApi.getTemplates(type!),
    staleTime: 3_600_000,
    enabled: type !== null,
  })
}
