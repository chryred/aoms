import type { AlertCountParams, AlertFilterParams, FeedbackSearchParams } from '@/api/alerts'
import type { HourlyParams } from '@/api/aggregations'
import type { PeriodType } from '@/types/aggregation'
import type { ReportType } from '@/types/report'

export const qk = {
  systems: () => ['systems'] as const,
  system: (id: number) => ['systems', id] as const,
  alerts: (params: AlertFilterParams) => ['alerts', params] as const,
  alertsCount: (params: AlertCountParams) => ['alerts', 'count', params] as const,
  feedbacks: (alertHistoryId: number) => ['feedbacks', alertHistoryId] as const,
  feedbackSearch: (params: FeedbackSearchParams) => ['feedbacks', 'search', params] as const,
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

  agents: (params?: { system_id?: number; agent_type?: string }) => ['agents', params] as const,
  agent: (id: number) => ['agents', id] as const,
  agentStatus: (id: number) => ['agents', id, 'status'] as const,
  agentConfig: (id: number) => ['agents', id, 'config'] as const,
  installJob: (jobId: string) => ['agents', 'jobs', jobId] as const,
  agentLiveStatus: (id: number) => ['agents', id, 'live-status'] as const,
  agentSystemLive: (systemId: number) => ['agents', 'system-live', systemId] as const,
  agentHealthSummary: ['agents', 'health-summary'] as const,
}
