import { useQuery } from '@tanstack/react-query'
import { logAnalyzerSearchApi } from '@/api/logAnalyzer'
import { qk } from '@/constants/queryKeys'

export function useCollectionInfo() {
  return useQuery({
    queryKey: qk.search.collectionInfo(),
    queryFn: () => logAnalyzerSearchApi.getCollectionInfo(),
    staleTime: 60_000,
    retry: 1,
  })
}
