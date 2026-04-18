export type AlertType = 'metric' | 'log_analysis'
export type Severity = 'info' | 'warning' | 'critical'
export type AnomalyType = 'new' | 'related' | 'recurring' | 'duplicate'

export interface AlertHistory {
  id: number
  system_id: number | null
  alert_type: AlertType
  severity: Severity
  alertname: string | null
  title: string
  description: string | null
  instance_role: string | null
  host: string | null
  acknowledged: boolean
  acknowledged_at: string | null
  acknowledged_by: string | null
  escalated: boolean
  anomaly_type: AnomalyType | null
  similarity_score: number | null
  qdrant_point_id: string | null
  resolved_at: string | null
  notified_contacts: string | null
  /** LLM/분석 실패 사유 — NULL이면 정상, 값 있으면 UI "분석 실패" 뱃지 표시 */
  error_message: string | null
  /** OTel: 알림 발생 시각 ±60s 내 연관 trace_id 목록 */
  related_trace_ids: string[] | null
  created_at: string
}
