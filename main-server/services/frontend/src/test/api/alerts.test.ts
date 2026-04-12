import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ky-client', () => ({
  adminApi: {
    get: vi.fn(),
    post: vi.fn(),
  },
  filterParams: vi.fn((p: object) => p),
}))

import { alertsApi } from '@/api/alerts'
import { adminApi } from '@/lib/ky-client'

function mockReturn(method: 'get' | 'post', value: unknown) {
  vi.mocked(adminApi[method]).mockReturnValue({ json: vi.fn().mockResolvedValue(value) } as never)
}

describe('alertsApi', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getAlerts — 파라미터 없이', async () => {
    mockReturn('get', [])
    await alertsApi.getAlerts()
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/alerts', { searchParams: {} })
  })

  it('getAlerts — 파라미터와 함께', async () => {
    mockReturn('get', [])
    const params = { system_id: 1, severity: 'critical' as const, limit: 20 }
    await alertsApi.getAlerts(params)
    expect(adminApi.get).toHaveBeenCalledWith('api/v1/alerts', { searchParams: params })
  })

  it('acknowledgeAlert', async () => {
    mockReturn('post', { id: 1, acknowledged: true })
    const body = { acknowledged_by: 'admin' }
    await alertsApi.acknowledgeAlert(1, body)
    expect(adminApi.post).toHaveBeenCalledWith('api/v1/alerts/1/acknowledge', { json: body })
  })
})
