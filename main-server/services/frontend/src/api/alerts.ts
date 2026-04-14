import { adminApi, filterParams } from '@/lib/ky-client'
import type { AlertHistory, Severity, AlertType } from '@/types/alert'

export interface AlertFilterParams {
  system_id?: number
  severity?: Severity
  alert_type?: AlertType
  resolved?: boolean
  acknowledged?: boolean
  limit?: number
  offset?: number
}

export interface FeedbackCreateBody {
  alert_history_id: number
  error_type: string
  solution: string
  resolver: string
}

export interface FeedbackUpdateBody {
  error_type: string
  solution: string
  resolver: string
}

export interface FeedbackOut {
  id: number
  system_id: number | null
  alert_history_id: number | null
  error_type: string
  solution: string
  resolver: string
  created_at: string
}

export const alertsApi = {
  getAlerts: (params: AlertFilterParams = {}) =>
    adminApi.get('api/v1/alerts', { searchParams: filterParams(params) }).json<AlertHistory[]>(),

  acknowledgeAlert: (id: number, body: { acknowledged_by: string }) =>
    adminApi.post(`api/v1/alerts/${id}/acknowledge`, { json: body }).json<AlertHistory>(),

  createFeedback: (body: FeedbackCreateBody) =>
    adminApi.post('api/v1/feedback', { json: body }).json<FeedbackOut>(),

  getFeedbacks: (alertHistoryId: number) =>
    adminApi
      .get('api/v1/feedback', {
        searchParams: { alert_history_id: alertHistoryId },
      })
      .json<FeedbackOut[]>(),

  updateFeedback: (id: number, body: FeedbackUpdateBody) =>
    adminApi.put(`api/v1/feedback/${id}`, { json: body }).json<FeedbackOut>(),
}
