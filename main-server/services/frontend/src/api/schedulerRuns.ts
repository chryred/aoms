import { adminApi, filterParams } from '@/lib/ky-client'
import type { SchedulerRun, SchedulerType } from '@/types/schedulerRun'

export const schedulerRunsApi = {
  getRuns: (params?: {
    scheduler_type?: SchedulerType | ''
    status?: 'ok' | 'error' | ''
    date_from?: string
    date_to?: string
    limit?: number
    offset?: number
  }) =>
    adminApi
      .get('api/v1/scheduler-runs', { searchParams: filterParams(params ?? {}) })
      .json<SchedulerRun[]>(),
}
