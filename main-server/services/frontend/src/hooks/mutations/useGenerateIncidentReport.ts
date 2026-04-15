import { useMutation } from '@tanstack/react-query'
import { alertsApi } from '@/api/alerts'

export function useGenerateIncidentReport() {
  return useMutation({
    mutationFn: (id: number) => alertsApi.generateIncidentReport(id),
  })
}
