import { useMutation } from '@tanstack/react-query'
import { alertsApi, type FeedbackCreateBody } from '@/api/alerts'
import toast from 'react-hot-toast'

export function useCreateFeedback() {
  return useMutation({
    mutationFn: (body: FeedbackCreateBody) => alertsApi.createFeedback(body),
    onSuccess: () => toast.success('해결책이 등록되었습니다'),
    onError: () => toast.error('해결책 등록 중 오류가 발생했습니다'),
  })
}
