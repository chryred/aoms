import { useQuery } from '@tanstack/react-query'
import { incidentsApi } from '@/api/incidents'
import type { Feedback } from '@/types/feedback'

/** 인시던트에 등록된 피드백 목록 (기본: approved만). status='all' 로 전체 조회 가능 */
export function useIncidentFeedback(incidentId: number | null, status?: string) {
  return useQuery({
    queryKey: ['incident-feedback', incidentId, status],
    queryFn: () => incidentsApi.listFeedback(incidentId!, status),
    enabled: incidentId !== null,
    staleTime: 15_000,
    refetchInterval: (query) => {
      const data = query.state.data as Feedback[] | undefined
      if (!data) return false
      const hasProcessing = data.some((fb) =>
        fb.attachments?.some((a) => a.ocr_status === 'processing'),
      )
      return hasProcessing ? 5000 : false
    },
  })
}
