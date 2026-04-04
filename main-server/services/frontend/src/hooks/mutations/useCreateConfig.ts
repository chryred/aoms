import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { collectorConfigApi } from '@/api/collectorConfig'
import type { CollectorConfigCreate } from '@/types/collectorConfig'

export function useCreateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CollectorConfigCreate) => collectorConfigApi.createConfig(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collector-configs'] })
    },
    onError: () => {
      toast.error('수집기 설정 등록에 실패했습니다')
    },
  })
}
