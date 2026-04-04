import { useMutation, useQueryClient } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'

export function useDeleteSystem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => systemsApi.deleteSystem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systems() })
      toast.success('시스템이 삭제되었습니다')
    },
    onError: () => toast.error('시스템 삭제에 실패했습니다'),
  })
}
