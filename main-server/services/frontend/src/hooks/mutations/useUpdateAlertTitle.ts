import { useMutation, useQueryClient } from '@tanstack/react-query'
import { alertsApi } from '@/api/alerts'

export function useUpdateAlertTitle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      alertsApi.updateTitle(id, title),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
