import { useQuery } from '@tanstack/react-query'
import { guidesApi } from '@/api/guides'
import { qk } from '@/constants/queryKeys'
import type { GuideListParams } from '@/types/guide'

export function useGuides(params?: GuideListParams) {
  return useQuery({
    queryKey: qk.guides.list(params),
    queryFn: () => guidesApi.list(params),
    staleTime: 30_000,
  })
}

export function useGuide(id: string) {
  return useQuery({
    queryKey: qk.guides.detail(id),
    queryFn: () => guidesApi.get(id),
    staleTime: 30_000,
    enabled: !!id,
  })
}
