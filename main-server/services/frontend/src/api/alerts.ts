import { adminApi } from '@/lib/ky-client'
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
    adminApi
      .get('api/v1/alerts', {
        searchParams: Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined)
        ) as Record<string, string | number | boolean>,
      })
      .json<AlertHistory[]>(),

  acknowledgeAlert: (id: number, body: { acknowledged_by: string }) =>
    adminApi
      .post(`api/v1/alerts/${id}/acknowledge`, { json: body })
      .json<AlertHistory>(),
}
