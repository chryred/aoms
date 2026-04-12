import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTrendAlerts } from '@/hooks/queries/useTrendAlerts'
import { createWrapper } from '../test-utils'
import { useUiStore } from '@/store/uiStore'

const mockGetTrendAlerts = vi.fn()

vi.mock('@/api/aggregations', () => ({
  aggregationsApi: {
    getTrendAlerts: () => mockGetTrendAlerts(),
  },
}))

describe('useTrendAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUiStore.setState({ criticalCount: 0 })
  })

  it('데이터 정렬 — critical 먼저', async () => {
    mockGetTrendAlerts.mockResolvedValueOnce([
      { id: 2, llm_severity: 'warning', hour_bucket: '2024-01-01T10:00:00Z' },
      { id: 1, llm_severity: 'critical', hour_bucket: '2024-01-01T09:00:00Z' },
      { id: 3, llm_severity: 'normal', hour_bucket: '2024-01-01T11:00:00Z' },
    ])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useTrendAlerts(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0].llm_severity).toBe('critical')
    expect(result.current.data?.[1].llm_severity).toBe('warning')
  })

  it('critical 개수 → uiStore 업데이트', async () => {
    mockGetTrendAlerts.mockResolvedValueOnce([
      { id: 1, llm_severity: 'critical', hour_bucket: '2024-01-01T10:00:00Z' },
      { id: 2, llm_severity: 'critical', hour_bucket: '2024-01-01T11:00:00Z' },
      { id: 3, llm_severity: 'warning', hour_bucket: '2024-01-01T12:00:00Z' },
    ])
    const { Wrapper } = createWrapper()
    renderHook(() => useTrendAlerts(), { wrapper: Wrapper })
    await waitFor(() => expect(useUiStore.getState().criticalCount).toBe(2))
  })

  it('빈 배열 → criticalCount=0', async () => {
    mockGetTrendAlerts.mockResolvedValueOnce([])
    const { Wrapper } = createWrapper()
    renderHook(() => useTrendAlerts(), { wrapper: Wrapper })
    await waitFor(() => expect(useUiStore.getState().criticalCount).toBe(0))
  })
})
