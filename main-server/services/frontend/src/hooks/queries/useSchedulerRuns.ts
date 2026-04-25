import { useQuery } from '@tanstack/react-query'
import { schedulerRunsApi } from '@/api/schedulerRuns'
import { qk } from '@/constants/queryKeys'
import type { SchedulerType } from '@/types/schedulerRun'

interface Params {
  scheduler_type?: SchedulerType | ''
  status?: 'ok' | 'error' | ''
  date_from?: string
  date_to?: string
  limit?: number
}

export function useSchedulerRuns(params?: Params) {
  return useQuery({
    queryKey: qk.schedulerRuns(params as Record<string, unknown>),
    queryFn: () => schedulerRunsApi.getRuns(params),
    staleTime: 30_000,
  })
}
