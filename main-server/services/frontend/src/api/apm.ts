import { adminApi, filterParams } from '@/lib/ky-client'
import type {
  ApmDashboard,
  ApmDashboardBody,
  ApmSystemSummary,
  ScatterParams,
  ScatterResult,
  ThreadDump,
  ThreadDumpListItem,
  ThreadDumpRequestResult,
  TxDetail,
  TxListParams,
  TxFilterParams,
  TxHourlyResult,
  TxListResult,
  TxUriStatsResult,
} from '@/types/apm'

/** `system_ids` 는 반복 파라미터(`system_ids=1&system_ids=2`)로 직렬화한다. */
function toSearchParams(params: { system_ids: number[] } & object): URLSearchParams {
  const { system_ids, ...rest } = params as { system_ids: number[] } & Record<string, unknown>
  const sp = new URLSearchParams()
  for (const id of system_ids) sp.append('system_ids', String(id))
  for (const [k, v] of Object.entries(filterParams(rest))) sp.append(k, String(v))
  return sp
}

export const apmApi = {
  listTransactions: (params: TxListParams) =>
    adminApi
      .get('api/v1/apm/transactions', { searchParams: toSearchParams(params) })
      .json<TxListResult>(),

  getTxStatsByUri: (params: TxFilterParams & { limit?: number }) =>
    adminApi
      .get('api/v1/apm/transactions/stats-by-uri', { searchParams: toSearchParams(params) })
      .json<TxUriStatsResult>(),

  getTxHourly: (params: TxFilterParams) =>
    adminApi
      .get('api/v1/apm/transactions/hourly', { searchParams: toSearchParams(params) })
      .json<TxHourlyResult>(),

  getTransaction: (traceId: string, spanId: string) =>
    adminApi.get(`api/v1/apm/transactions/${traceId}/${spanId}`).json<TxDetail>(),

  getScatter: (params: ScatterParams) =>
    adminApi
      .get('api/v1/apm/scatter', { searchParams: toSearchParams(params) })
      .json<ScatterResult>(),

  getSystemSummary: (systemId: number) =>
    adminApi.get(`api/v1/apm/systems/${systemId}/summary`).json<ApmSystemSummary>(),

  listDashboards: () => adminApi.get('api/v1/apm/dashboards').json<ApmDashboard[]>(),

  createDashboard: (body: ApmDashboardBody) =>
    adminApi.post('api/v1/apm/dashboards', { json: body }).json<ApmDashboard>(),

  updateDashboard: (id: number, body: ApmDashboardBody) =>
    adminApi.put(`api/v1/apm/dashboards/${id}`, { json: body }).json<ApmDashboard>(),

  deleteDashboard: (id: number) =>
    adminApi.delete(`api/v1/apm/dashboards/${id}`).then(() => undefined),

  shareDefault: (id: number) =>
    adminApi.post(`api/v1/apm/dashboards/${id}/share-default`).json<ApmDashboard>(),

  requestThreadDump: (agentId: number) =>
    adminApi.post(`api/v1/agents/${agentId}/thread-dump`).json<ThreadDumpRequestResult>(),

  listThreadDumps: (agentId: number, limit = 20) =>
    adminApi
      .get(`api/v1/agents/${agentId}/thread-dumps`, { searchParams: { limit } })
      .json<ThreadDumpListItem[]>(),

  getThreadDump: (agentId: number, commandId: number) =>
    adminApi.get(`api/v1/agents/${agentId}/thread-dumps/${commandId}`).json<ThreadDump>(),
}
