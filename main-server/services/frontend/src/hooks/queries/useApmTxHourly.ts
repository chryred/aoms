import { useQuery } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'
import type { TxFilterParams } from '@/types/apm'

/** 시간대(KST 00~23시)별 건수·평균 응답·SQL 평균 */
export function useApmTxHourly(params: TxFilterParams, enabled = true) {
  return useQuery({
    queryKey: qk.apm.txHourly(params),
    queryFn: () => apmApi.getTxHourly(params),
    enabled: enabled && params.system_ids.length > 0,
    staleTime: 30_000,
  })
}
