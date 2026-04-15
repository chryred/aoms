import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { alertsApi, type FeedbackSearchParams } from '@/api/alerts'
import { qk } from '@/constants/queryKeys'

export function useFeedbackSearch(params: FeedbackSearchParams) {
  return useQuery({
    queryKey: qk.feedbackSearch(params),
    queryFn: () => alertsApi.searchFeedbacks(params),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}
