import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  useHourlyAggregations,
  useDailyAggregations,
  useWeeklyAggregations,
  useMonthlyAggregations,
  useTrendAlerts,
} from '@/hooks/queries/useAggregations'
import { createWrapper } from '../test-utils'

const mockGetHourly = vi.fn()
const mockGetDaily = vi.fn()
const mockGetWeekly = vi.fn()
const mockGetMonthly = vi.fn()
const mockGetTrendAlerts = vi.fn()

vi.mock('@/api/aggregations', () => ({
  aggregationsApi: {
    getHourly: (p: object) => mockGetHourly(p),
    getDaily: (p: object) => mockGetDaily(p),
    getWeekly: (p: object) => mockGetWeekly(p),
    getMonthly: (p: object) => mockGetMonthly(p),
    getTrendAlerts: () => mockGetTrendAlerts(),
  },
}))

describe('useHourlyAggregations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('system_id 없으면 disabled', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useHourlyAggregations({}), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('system_id 있으면 API 호출', async () => {
    mockGetHourly.mockResolvedValueOnce([])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useHourlyAggregations({ system_id: 1, collector_type: 'synapse_agent' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGetHourly).toHaveBeenCalled()
  })
})

describe('useDailyAggregations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('데이터 로드', async () => {
    mockGetDaily.mockResolvedValueOnce([])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useDailyAggregations({}), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useWeeklyAggregations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('데이터 로드', async () => {
    mockGetWeekly.mockResolvedValueOnce([])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useWeeklyAggregations({}), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useMonthlyAggregations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('데이터 로드', async () => {
    mockGetMonthly.mockResolvedValueOnce([])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useMonthlyAggregations({}), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useTrendAlerts (aggregations)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('데이터 로드', async () => {
    mockGetTrendAlerts.mockResolvedValueOnce([
      { id: 1, llm_severity: 'critical' },
      { id: 2, llm_severity: 'warning' },
    ])
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useTrendAlerts(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(2)
  })
})
