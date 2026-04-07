import { adminApi, filterParams } from '@/lib/ky-client'
import type { ReportHistory, ReportType } from '@/types/report'

export const reportsApi = {
  getReports: (params?: { report_type?: ReportType; limit?: number }) =>
    adminApi
      .get('api/v1/reports', { searchParams: filterParams(params ?? {}) })
      .json<ReportHistory[]>(),

  getReport: (id: number) => adminApi.get(`api/v1/reports/${id}`).json<ReportHistory>(),
}
