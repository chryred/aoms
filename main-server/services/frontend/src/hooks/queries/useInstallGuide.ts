import { useQuery } from '@tanstack/react-query'
import { collectorConfigApi } from '@/api/collectorConfig'
import { qk } from '@/constants/queryKeys'

export function useInstallGuide(id: number | null) {
  return useQuery({
    queryKey: qk.installGuide(id ?? 0),
    queryFn: () => collectorConfigApi.getInstallGuide(id!),
    enabled: id !== null,
    staleTime: 30_000,
  })
}
