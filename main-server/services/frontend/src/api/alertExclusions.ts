import { adminApi, filterParams } from '@/lib/ky-client'

export interface AlertExclusionItem {
  system_id: number
  instance_role?: string | null
  template: string
  reason?: string | null
  max_count_per_window?: number | null
  expires_at?: string | null   // ISO 8601 UTC
}

export interface AlertExclusionCreate {
  items: AlertExclusionItem[]
  created_by?: string | null
}

export interface AlertExclusion {
  id: number
  system_id: number
  instance_role: string | null
  template: string
  reason: string | null
  created_by: string | null
  created_at: string
  active: boolean
  deactivated_by: string | null
  deactivated_at: string | null
  skip_count: number
  last_skipped_at: string | null
  max_count_per_window: number | null
  expires_at: string | null   // ISO 8601 UTC
}

export interface BulkExcludeResult {
  succeeded: number[]
  failed: { alert_id?: number; system_id?: number; template?: string; reason: string }[]
}

export interface AlertsBulkExcludeRequest {
  alert_ids: number[]
  reason?: string | null
  include_instance_role?: boolean
  created_by?: string | null
  max_count_per_window?: number | null
  expires_at?: string | null   // ISO 8601 UTC
}

export interface AlertExclusionListParams {
  system_id?: number
  active?: 'true' | 'false' | 'all'
  include_expired?: boolean
  limit?: number
  offset?: number
}

export interface AlertExclusionDeactivateRequest {
  ids: number[]
  deactivated_by?: string | null
}

export const alertExclusionsApi = {
  /** 예외 규칙 일괄 등록 */
  createExclusions: (body: AlertExclusionCreate) =>
    adminApi.post('api/v1/alert-exclusions', { json: body }).json<BulkExcludeResult>(),

  /** 예외 규칙 목록 조회 */
  listExclusions: (params: AlertExclusionListParams = {}) =>
    adminApi
      .get('api/v1/alert-exclusions', { searchParams: filterParams(params) })
      .json<AlertExclusion[]>(),

  /** 예외 규칙 일괄 해제 */
  deactivateExclusions: (body: AlertExclusionDeactivateRequest) =>
    adminApi
      .patch('api/v1/alert-exclusions/deactivate', { json: body })
      .json<BulkExcludeResult>(),

  /** 알림 다건 → 예외 일괄 등록 (alert_history 기반) */
  bulkExcludeAlerts: (body: AlertsBulkExcludeRequest) =>
    adminApi.post('api/v1/alerts/bulk-exclude', { json: body }).json<BulkExcludeResult>(),
}
