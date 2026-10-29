import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'
import type { ApmDashboardBody } from '@/types/apm'

export function useApmDashboardMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.apm.dashboards() })

  const create = useMutation({
    mutationFn: (body: ApmDashboardBody) => apmApi.createDashboard(body),
    onSuccess: () => {
      invalidate()
      toast.success('화면이 저장되었습니다')
    },
    onError: () => toast.error('화면 저장 중 오류가 발생했습니다'),
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ApmDashboardBody }) =>
      apmApi.updateDashboard(id, body),
    onSuccess: () => {
      invalidate()
      toast.success('화면이 저장되었습니다')
    },
    onError: () => toast.error('화면 저장 중 오류가 발생했습니다'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => apmApi.deleteDashboard(id),
    onSuccess: () => {
      invalidate()
      toast.success('화면이 삭제되었습니다')
    },
    onError: () => toast.error('화면 삭제 중 오류가 발생했습니다'),
  })

  const shareDefault = useMutation({
    mutationFn: (id: number) => apmApi.shareDefault(id),
    onSuccess: () => {
      invalidate()
      toast.success('공유 기본 화면으로 지정되었습니다')
    },
    onError: () => toast.error('기본 화면 지정 중 오류가 발생했습니다'),
  })

  return { create, update, remove, shareDefault }
}
