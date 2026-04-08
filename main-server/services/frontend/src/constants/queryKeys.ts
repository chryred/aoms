import type { AlertFilterParams } from '@/api/alerts'
import type { HourlyParams } from '@/api/aggregations'
import type { PeriodType } from '@/types/aggregation'
import type { ReportType } from '@/types/report'
import type { CollectorConfigFilterParams } from '@/api/collectorConfig'
import type { CollectorType } from '@/types/collectorConfig'

export const qk = {
  systems: () => ['systems'] as const,
  system: (id: number) => ['systems', id] as const,
  alerts: (params: AlertFilterParams) => ['alerts', params] as const,
  me: () => ['auth', 'me'] as const,

  contacts: () => ['contacts'] as const,
  contact: (id: number) => ['contacts', id] as const,
  systemContacts: (systemId: number) => ['systems', systemId, 'contacts'] as const,

  aggregations: {
    hourly: (params: HourlyParams) => ['aggregations', 'hourly', params] as const,
    daily: (params: { system_id?: number; collector_type?: string }) =>
      ['aggregations', 'daily', params] as const,
    weekly: (params: { system_id?: number }) => ['aggregations', 'weekly', params] as const,
    monthly: (params: { system_id?: number; period_type?: PeriodType }) =>
      ['aggregations', 'monthly', params] as const,
    trends: () => ['aggregations', 'trends'] as const,
  },

  reports: (type?: ReportType) => ['reports', type] as const,

  search: {
    collectionInfo: () => ['search', 'collection-info'] as const,
    aggregationStatus: () => ['search', 'aggregation-status'] as const,
  },

  collectorConfigs: (params?: CollectorConfigFilterParams) =>
    ['collector-configs', params] as const,

  collectorTemplates: (type: CollectorType) => ['collector-templates', type] as const,
}
