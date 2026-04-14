import { useQuery } from '@tanstack/react-query'
import { alertsApi } from '@/api/alerts'
import { qk } from '@/constants/queryKeys'

export function useFeedbacks(alertHistoryId: number | null) {
  return useQuery({
    queryKey: qk.feedbacks(alertHistoryId ?? 0),
    queryFn: () => alertsApi.getFeedbacks(alertHistoryId!),
    enabled: alertHistoryId !== null,
    staleTime: 10_000,
  })
}
