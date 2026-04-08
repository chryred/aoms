import { adminApi, filterParams } from '@/lib/ky-client'
import type { AlertHistory, Severity, AlertType } from '@/types/alert'

export interface AlertFilterParams {
  system_id?: number
  severity?: Severity
  alert_type?: AlertType
  acknowledged?: boolean
  limit?: number
  offset?: number
}

export const alertsApi = {
  getAlerts: (params: AlertFilterParams = {}) =>
    adminApi.get('api/v1/alerts', { searchParams: filterParams(params) }).json<AlertHistory[]>(),

  acknowledgeAlert: (id: number, body: { acknowledged_by: string }) =>
    adminApi.post(`api/v1/alerts/${id}/acknowledge`, { json: body }).json<AlertHistory>(),
}
