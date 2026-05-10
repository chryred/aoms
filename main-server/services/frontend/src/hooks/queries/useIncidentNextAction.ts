import { useIncident } from '@/hooks/queries/useIncidents'
import type { NextActionMeta } from '@/api/incidents'

/**
 * 챗봇 panel이 인시던트 컨텍스트를 받았을 때 next_action_meta만 추출.
 * useIncident와 동일한 query key를 사용하므로 IncidentDetailPage가 열려 있으면 dedupe됨.
 * Feature 5C-1 선제적 통찰 — status별 추천 prompt chip 표시용.
 */
export function useIncidentNextAction(incidentId: string | null | undefined): {
  data: NextActionMeta | null
  isLoading: boolean
} {
  const id = incidentId ? Number(incidentId) : 0
  const query = useIncident(id)
  return {
    isLoading: query.isLoading,
    data: query.data?.next_action_meta ?? null,
  }
}
