import { useQuery } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'
import type { TxFilterParams } from '@/types/apm'

/** URI 별 집계 (조회 조건 전체 기준) */
export function useApmTxStats(params: TxFilterParams & { limit?: number }, enabled = true) {
  return useQuery({
    queryKey: qk.apm.txStats(params),
    queryFn: () => apmApi.getTxStatsByUri(params),
    enabled: enabled && params.system_ids.length > 0,
    staleTime: 30_000,
  })
}
