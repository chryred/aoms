import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { createWrapper } from '../test-utils'

const mockGetAlerts = vi.fn()

vi.mock('@/api/alerts', () => ({
  alertsApi: {
    getAlerts: (params: object) => mockGetAlerts(params),
  },
}))

describe('useAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('데이터 로드', async () => {
    const alerts = [{ id: 1, alert_name: 'HighCPU' }]
    mockGetAlerts.mockResolvedValueOnce(alerts)
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useAlerts(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(alerts)
  })

  it('파라미터 전달', async () => {
    mockGetAlerts.mockResolvedValueOnce([])
    const { Wrapper } = createWrapper()
    const params = { system_id: 1, severity: 'critical' as const }
    const { result } = renderHook(() => useAlerts(params), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGetAlerts).toHaveBeenCalledWith(params)
  })
})
