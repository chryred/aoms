import { useMutation, useQueryClient } from '@tanstack/react-query'
import { feedbacksApi } from '@/api/feedbacks'

export function useFeedbackUpload() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => feedbacksApi.upload(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedbacks'] })
    },
  })
}
