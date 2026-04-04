import { useQuery } from '@tanstack/react-query'
import { logAnalyzerSearchApi } from '@/api/logAnalyzer'
import { qk } from '@/constants/queryKeys'

export function useAggregationStatus() {
  return useQuery({
    queryKey: qk.search.aggregationStatus(),
    queryFn: () => logAnalyzerSearchApi.getAggregationStatus(),
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}
