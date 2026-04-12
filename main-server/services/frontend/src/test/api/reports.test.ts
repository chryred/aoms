import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ky-client', () => ({
  adminApi: {
    get: vi.fn(),
  },
  filterParams: vi.fn((p: object) => p),
}))

import { reportsApi } from '@/api/reports'
import { adminApi } from '@/lib/ky-client'

describe('reportsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adminApi.get).mockReturnValue({ json: vi.fn().mockResolvedValue([]) } as never)
  })

  it('getReports — 파라미터 없이', async () => {
    await reportsApi.getReports()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/reports', { searchParams: {} })
  })

  it('getReports — report_type 지정', async () => {
    await reportsApi.getReports({ report_type: 'daily' })
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/reports', {
      searchParams: { report_type: 'daily' },
    })
  })

  it('getReport', async () => {
    vi.mocked(adminApi.get).mockReturnValue({ json: vi.fn().mockResolvedValue({ id: 7 }) } as never)
    await reportsApi.getReport(7)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/reports/7')
  })
})
