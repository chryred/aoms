import { useQuery } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'
import type { ScatterParams } from '@/types/apm'

export function useApmScatter(params: ScatterParams, enabled = true) {
  return useQuery({
    queryKey: qk.apm.scatter(params),
    queryFn: () => apmApi.getScatter(params),
    enabled: enabled && params.system_ids.length > 0,
    staleTime: 30_000,
  })
}
