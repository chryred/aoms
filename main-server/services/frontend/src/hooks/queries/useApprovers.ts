import { useQuery } from '@tanstack/react-query'
import { feedbacksApi } from '@/api/feedbacks'

export function useApprovers() {
  return useQuery({
    queryKey: ['approvers'],
    queryFn: () => feedbacksApi.approvers(),
    staleTime: 60_000,
  })
}
