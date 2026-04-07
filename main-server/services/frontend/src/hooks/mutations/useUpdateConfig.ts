import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { collectorConfigApi } from '@/api/collectorConfig'
import { qk } from '@/constants/queryKeys'
import type { CollectorConfigUpdate } from '@/types/collectorConfig'

export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CollectorConfigUpdate }) =>
      collectorConfigApi.updateConfig(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.collectorConfigs() })
    },
    onError: () => {
      toast.error('수집기 설정 수정에 실패했습니다')
    },
  })
}
