import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { incidentsApi } from '@/api/incidents'
import type { FeedbackCreateRequest } from '@/types/feedback'

export function useCreateIncidentFeedback(incidentId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: FeedbackCreateRequest) => incidentsApi.createFeedback(incidentId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-feedback', incidentId] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      toast.success('해결책이 등록되었습니다')
    },
    onError: () => toast.error('해결책 등록 중 오류가 발생했습니다'),
  })
}
