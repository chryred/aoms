import { adminApi } from '@/lib/ky-client'

export interface TemplateClassification {
  template: string
  is_notification: boolean
  reason?: string
}

export interface TemplateChange {
  template: string
  new_severity: 'info' | 'warning' | 'critical'
}

export interface ReclassifyRequest {
  template_changes: TemplateChange[]
  reclassified_by?: string
}

export interface ReclassifyResult {
  reclassified_from: number
  new_alert_history_ids: number[]
  /** 재분류 후 자동 정보화된 유사 패턴 수 */
  auto_updated_notification_count?: number
  /** 재분류 후 자동 실에러화된 유사 패턴 수 */
  auto_updated_real_error_count?: number
}

export interface SimilarRealErrorCandidate {
  point_id: string
  score: number
  log_pattern: string
  severity: string
  alert_history_id: number | null
  title: string | null
  created_at: string | null
}

export interface SimpleReclassifyRequest {
  target_severity: 'info' | 'warning' | 'critical'
  reclassified_by?: string
}

export interface SimpleReclassifyResult {
  reclassified_from: number
  new_alert_history_id: number
}

export const reclassifyApi = {
  reclassify: (alertHistoryId: number, body: ReclassifyRequest) =>
    adminApi
      .patch(`api/v1/analysis/reclassify/${alertHistoryId}`, { json: body })
      .json<ReclassifyResult>(),

  simpleReclassify: (alertHistoryId: number, body: SimpleReclassifyRequest) =>
    adminApi
      .patch(`api/v1/analysis/reclassify/${alertHistoryId}/simple`, { json: body })
      .json<SimpleReclassifyResult>(),

  changeNotificationSeverity: (
    alertHistoryId: number,
    body: { new_severity: 'info' | 'warning' | 'critical' },
  ) =>
    adminApi
      .patch(`api/v1/analysis/${alertHistoryId}/notification-severity`, { json: body })
      .json<{ updated: boolean; new_severity: string }>(),

  // 유사 후보 미리보기 — isNotification으로 방향 구분
  // false → 실에러 후보(goal#3: warning→info), true → 알림성 후보(역방향: info→warning/critical)
  previewSimilarCandidates: (alertHistoryId: number, isNotification: boolean, scoreThreshold = 0.9) =>
    adminApi
      .get(
        `api/v1/analysis/${alertHistoryId}/${isNotification ? 'similar-notifications' : 'similar-real-errors'}`,
        { searchParams: { score_threshold: scoreThreshold } },
      )
      .json<{ candidates: SimilarRealErrorCandidate[] }>(),

  // 일괄 전환 — targetSeverity='info' → 정보화, 'warning'/'critical' → 실에러화
  bulkRelabel: (
    pointIds: string[],
    targetSeverity: 'info' | 'warning' | 'critical',
    reclassifiedBy?: string,
  ) =>
    adminApi
      .post(
        `api/v1/analysis/${targetSeverity === 'info' ? 'bulk-relabel-notification' : 'bulk-relabel-real-error'}`,
        {
          json: {
            point_ids: pointIds,
            reclassified_by: reclassifiedBy,
            ...(targetSeverity !== 'info' && { target_severity: targetSeverity }),
          },
        },
      )
      .json<{ updated_point_ids: string[]; updated_alert_history_ids: number[] }>(),
}
