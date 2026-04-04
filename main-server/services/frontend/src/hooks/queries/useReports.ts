import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '@/api/reports'
import { qk } from '@/constants/queryKeys'
import type { ReportType } from '@/types/report'

export function useReports(params?: { report_type?: ReportType; limit?: number }) {
  return useQuery({
    queryKey: qk.reports(params?.report_type),
    queryFn: () => reportsApi.getReports(params),
    staleTime: 60_000,
  })
}
