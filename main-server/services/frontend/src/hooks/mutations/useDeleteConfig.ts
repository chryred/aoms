import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { collectorConfigApi } from '@/api/collectorConfig'

export function useDeleteConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => collectorConfigApi.deleteConfig(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collector-configs'] })
      toast.success('수집기 설정이 삭제되었습니다')
    },
    onError: () => {
      toast.error('수집기 설정 삭제에 실패했습니다')
    },
  })
}
