import { useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '@/api/alerts'
import type { AlertHistory } from '@/types/alert'
import toast from 'react-hot-toast'

export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, by }: { id: number; by: string }) =>
      alertsApi.acknowledgeAlert(id, { acknowledged_by: by }),
    onSuccess: (updatedAlert: AlertHistory) => {
      // 리패치 완료 전에도 목록의 해당 알림을 즉시 갱신 (stale snapshot 재확인 방지)
      qc.setQueriesData<AlertHistory[]>({ queryKey: ['alerts'] }, (old) => {
        if (!Array.isArray(old)) return old
        return old.map((a) => (a.id === updatedAlert.id ? updatedAlert : a))
      })
      qc.invalidateQueries({ queryKey: ['alerts'] })
      toast.success('알림이 확인 처리되었습니다')
    },
    onError: () => toast.error('처리 중 오류가 발생했습니다'),
  })
}
