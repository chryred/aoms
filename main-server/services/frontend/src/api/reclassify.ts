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
}
