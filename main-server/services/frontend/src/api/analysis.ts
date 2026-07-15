import { adminApi } from '@/lib/ky-client'

/** GET /api/v1/analysis/{id} 응답 (LogAnalysisOut) — "로그 전체 보기" 모달에서 원본 로그 라인 조회용 */
export interface LogAnalysisDetail {
  id: number
  system_id: number | null
  instance_role: string | null
  severity: string
  /** 수집 사이클에 잡힌 오류 로그 라인 (횟수 프리픽스 + PII 마스킹된 template blob) */
  log_content: string | null
  root_cause: string | null
  recommendation: string | null
  templates_json: string[] | null
  real_error_count: number
  created_at: string
}

export const analysisApi = {
  getAnalysis: (id: number) => adminApi.get(`api/v1/analysis/${id}`).json<LogAnalysisDetail>(),
}
