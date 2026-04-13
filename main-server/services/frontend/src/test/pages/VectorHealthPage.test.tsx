import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VectorHealthPage } from '@/pages/VectorHealthPage'

vi.mock('@/hooks/queries/useCollectionInfo', () => ({ useCollectionInfo: vi.fn() }))
vi.mock('@/hooks/queries/useAggregationStatus', () => ({ useAggregationStatus: vi.fn() }))

import { useCollectionInfo } from '@/hooks/queries/useCollectionInfo'
import { useAggregationStatus } from '@/hooks/queries/useAggregationStatus'

const mockCollectionInfo = {
  metric_hourly_patterns: { status: 'green', points_count: 1234, vectors_count: 1234 },
  aggregation_summaries: { status: 'yellow', points_count: 56, vectors_count: 56 },
}
const mockAggStatus = {
  hourly: { running: false, last_run: '2026-01-01T00:00:00Z', last_status: 'ok' },
  daily: { running: true, last_run: null, last_status: null },
  weekly: { running: false, last_run: null, last_status: 'error' },
  monthly: { running: false, last_run: null, last_status: null },
  longperiod: { running: false, last_run: null, last_status: null },
  trend: { running: false, last_run: null, last_status: null },
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VectorHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VectorHealthPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('로딩 상태', () => {
    vi.mocked(useCollectionInfo).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useAggregationStatus).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('오류 상태', () => {
    vi.mocked(useCollectionInfo).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error(),
      refetch: vi.fn(),
    } as never)
    vi.mocked(useAggregationStatus).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('컬렉션 현황 표시', () => {
    vi.mocked(useCollectionInfo).mockReturnValue({
      data: mockCollectionInfo,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useAggregationStatus).mockReturnValue({
      data: mockAggStatus,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText('컬렉션 현황')).toBeInTheDocument()
    expect(screen.getAllByText('1,234').length).toBeGreaterThan(0)
  })

  it('파이프라인 상태 표시', () => {
    vi.mocked(useCollectionInfo).mockReturnValue({
      data: mockCollectionInfo,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useAggregationStatus).mockReturnValue({
      data: mockAggStatus,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText('1시간')).toBeInTheDocument()
    expect(screen.getAllByText('정상').length).toBeGreaterThan(0)
    expect(screen.getByText('실행 중')).toBeInTheDocument()
    expect(screen.getByText('오류')).toBeInTheDocument()
  })

  it('새로고침 버튼', async () => {
    const refetchCollection = vi.fn()
    const refetchAgg = vi.fn()
    vi.mocked(useCollectionInfo).mockReturnValue({
      data: mockCollectionInfo,
      isLoading: false,
      error: null,
      refetch: refetchCollection,
    } as never)
    vi.mocked(useAggregationStatus).mockReturnValue({
      data: mockAggStatus,
      isLoading: false,
      error: null,
      refetch: refetchAgg,
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /새로고침/ }))
    expect(refetchCollection).toHaveBeenCalled()
    expect(refetchAgg).toHaveBeenCalled()
  })
})
