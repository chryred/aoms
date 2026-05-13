import { adminApi, filterParams } from '@/lib/ky-client'

export interface AlertExclusionItem {
  system_id: number
  instance_role?: string | null
  template: string
  reason?: string | null
  max_count_per_window?: number | null
  expires_at?: string | null // ISO 8601 UTC
  exclusion_type?: 'skip' | 'force_real' // 'skip': 완전 제외 | 'force_real': LLM 오판 정정
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
  expires_at: string | null // ISO 8601 UTC
  exclusion_type: 'skip' | 'force_real'
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
  expires_at?: string | null // ISO 8601 UTC
  exclusion_type?: 'skip' | 'force_real'
}

export interface AlertTemplateInfo {
  alert_id: number
  system_id: number | null
  instance_role: string | null
  templates: string[]
}

/** 모달에서 체크박스 단위로 관리하는 중복 제거된 템플릿 항목 */
export interface TemplateSelectItem {
  key: string // `${system_id}:${instance_role ?? ''}:${template}`
  system_id: number
  instance_role: string | null
  template: string
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
    adminApi.patch('api/v1/alert-exclusions/deactivate', { json: body }).json<BulkExcludeResult>(),

  /** 알림 다건 → 예외 일괄 등록 (alert_history 기반) */
  bulkExcludeAlerts: (body: AlertsBulkExcludeRequest) =>
    adminApi.post('api/v1/alerts/bulk-exclude', { json: body }).json<BulkExcludeResult>(),

  /** 선택된 알림들의 templates_json 조회 (예외 처리 모달용) */
  fetchAlertTemplates: (alert_ids: number[]) =>
    adminApi.post('api/v1/alerts/templates', { json: { alert_ids } }).json<AlertTemplateInfo[]>(),
}
