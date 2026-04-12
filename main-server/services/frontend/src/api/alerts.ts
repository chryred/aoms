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
}
