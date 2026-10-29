import { useQuery } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'
import type { TxListParams } from '@/types/apm'

export function useApmTransactions(params: TxListParams, enabled = true) {
  return useQuery({
    queryKey: qk.apm.transactions(params),
    queryFn: () => apmApi.listTransactions(params),
    enabled: enabled && params.system_ids.length > 0,
    staleTime: 30_000,
  })
}
