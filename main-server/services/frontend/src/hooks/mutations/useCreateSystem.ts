import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'
import type { SystemCreate } from '@/types/system'

export function useCreateSystem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SystemCreate) => systemsApi.createSystem(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systems() })
      toast.success('시스템이 등록되었습니다')
    },
    onError: () => toast.error('시스템 등록에 실패했습니다'),
  })
}
