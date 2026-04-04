import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'
import type { SystemUpdate } from '@/types/system'

export function useUpdateSystem(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SystemUpdate) => systemsApi.updateSystem(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systems() })
      qc.invalidateQueries({ queryKey: qk.system(id) })
      toast.success('시스템이 수정되었습니다')
    },
    onError: () => toast.error('시스템 수정에 실패했습니다'),
  })
}
