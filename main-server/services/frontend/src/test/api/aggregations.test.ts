import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ky-client', () => ({
  adminApi: {
    get: vi.fn(),
  },
  filterParams: vi.fn((p: object) => p),
}))

import { aggregationsApi } from '@/api/aggregations'
import { adminApi } from '@/lib/ky-client'

describe('aggregationsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adminApi.get).mockReturnValue({ json: vi.fn().mockResolvedValue([]) } as never)
  })

  it('getHourly', async () => {
    const params = { system_id: 1, collector_type: 'synapse_agent' }
    await aggregationsApi.getHourly(params)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/aggregations/hourly', {
      searchParams: params,
    })
  })

  it('getDaily', async () => {
    await aggregationsApi.getDaily({ system_id: 2 })
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/aggregations/daily', {
      searchParams: { system_id: 2 },
    })
  })

  it('getWeekly', async () => {
    await aggregationsApi.getWeekly({})
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/aggregations/weekly', { searchParams: {} })
  })

  it('getMonthly', async () => {
    await aggregationsApi.getMonthly({ period_type: 'monthly' })
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/aggregations/monthly', {
      searchParams: { period_type: 'monthly' },
    })
  })

  it('getTrendAlerts', async () => {
    await aggregationsApi.getTrendAlerts()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/aggregations/trend-alert')
  })
})
