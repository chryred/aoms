import { adminApi } from '@/lib/ky-client'
import type { ReportHistory, ReportType } from '@/types/report'

export const reportsApi = {
  getReports: (params?: { report_type?: ReportType; limit?: number }) =>
    adminApi
      .get('api/v1/reports', {
        searchParams: Object.fromEntries(
          Object.entries(params ?? {}).filter(([, v]) => v !== undefined),
        ) as Record<string, string | number>,
      })
      .json<ReportHistory[]>(),

  getReport: (id: number) => adminApi.get(`api/v1/reports/${id}`).json<ReportHistory>(),
}
