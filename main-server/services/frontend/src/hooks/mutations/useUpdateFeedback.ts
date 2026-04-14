import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { alertsApi, type FeedbackUpdateBody } from '@/api/alerts'

export function useUpdateFeedback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: FeedbackUpdateBody }) =>
      alertsApi.updateFeedback(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedbacks'] })
      toast.success('피드백이 수정되었습니다')
    },
    onError: () => toast.error('피드백 수정 중 오류가 발생했습니다'),
  })
}
