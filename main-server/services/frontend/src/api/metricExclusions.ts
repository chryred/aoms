import { adminApi, filterParams } from '@/lib/ky-client'

import type { MetricType } from '@/constants/metricTypes'

export interface MetricExclusionItem {
  system_id: number
  /** NULL = 시스템 전체 host 와일드카드 */
  host?: string | null
  metric_type: MetricType
  /** NULL = 완전 차단. 값 있으면 해당 메트릭만 임계치 대체 */
  override_threshold?: number | null
  reason?: string | null
  expires_at?: string | null // ISO 8601 UTC
}

export interface MetricExclusionCreate {
  items: MetricExclusionItem[]
  created_by?: string | null
}

export interface MetricExclusion {
  id: number
  system_id: number
  host: string | null
  metric_type: MetricType
  override_threshold: number | null
  reason: string | null
  created_by: string | null
  created_at: string
  active: boolean
  deactivated_by: string | null
  deactivated_at: string | null
  skip_count: number
  last_skipped_at: string | null
  expires_at: string | null
}

export interface BulkExcludeResult {
  succeeded: number[]
  failed: { system_id?: number; host?: string | null; metric_type?: string; reason: string }[]
}

export interface MetricExclusionListParams {
  system_id?: number
  active?: 'true' | 'false' | 'all'
  include_expired?: boolean
  limit?: number
  offset?: number
}

export interface MetricExclusionDeactivateRequest {
  ids: number[]
  deactivated_by?: string | null
}

export const metricExclusionsApi = {
  createExclusions: (body: MetricExclusionCreate) =>
    adminApi.post('api/v1/metric-exclusions', { json: body }).json<BulkExcludeResult>(),

  listExclusions: (params: MetricExclusionListParams = {}) =>
    adminApi
      .get('api/v1/metric-exclusions', { searchParams: filterParams(params) })
      .json<MetricExclusion[]>(),

  deactivateExclusions: (body: MetricExclusionDeactivateRequest) =>
    adminApi.patch('api/v1/metric-exclusions/deactivate', { json: body }).json<BulkExcludeResult>(),
}
