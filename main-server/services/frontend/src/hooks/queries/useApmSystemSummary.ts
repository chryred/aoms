import { useQuery } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'

export function useApmSystemSummary(systemId: number | undefined) {
  return useQuery({
    queryKey: qk.apm.systemSummary(systemId ?? 0),
    queryFn: () => apmApi.getSystemSummary(systemId!),
    enabled: systemId != null,
    staleTime: 60_000,
  })
}
