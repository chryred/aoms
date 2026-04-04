import { useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '@/api/alerts'
import toast from 'react-hot-toast'

export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, by }: { id: number; by: string }) =>
      alertsApi.acknowledgeAlert(id, { acknowledged_by: by }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('알림이 확인 처리되었습니다')
    },
    onError: () => toast.error('처리 중 오류가 발생했습니다'),
  })
}
