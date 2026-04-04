import { useMutation } from '@tanstack/react-query'
import { logAnalyzerSearchApi } from '@/api/logAnalyzer'
import type { SimilarSearchRequest, SimilarSearchResponse } from '@/types/search'

export function useSimilarSearch() {
  return useMutation<SimilarSearchResponse, Error, SimilarSearchRequest>({
    mutationFn: (body: SimilarSearchRequest) =>
      logAnalyzerSearchApi.similarSearch(body),
  })
}
