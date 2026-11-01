import { useQuery } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'

export function useApmTransactionDetail(traceId: string | undefined, spanId: string | undefined) {
  return useQuery({
    queryKey: qk.apm.transaction(traceId ?? '', spanId ?? ''),
    queryFn: () => apmApi.getTransaction(traceId!, spanId!),
    enabled: !!traceId && !!spanId,
    staleTime: 60_000,
  })
}
