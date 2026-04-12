import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReportPage } from '@/pages/ReportPage'

vi.mock('@/hooks/queries/useSystems', () => ({ useSystems: vi.fn() }))
vi.mock('@/hooks/queries/useAggregations', () => ({
  useDailyAggregations: vi.fn(),
  useWeeklyAggregations: vi.fn(),
  useMonthlyAggregations: vi.fn(),
}))
vi.mock('@/components/reports/AggregationCard', () => ({
  AggregationCard: ({ systemName }: { systemName: string }) => (
    <div data-testid="aggregation-card">{systemName}</div>
  ),
}))

import { useSystems } from '@/hooks/queries/useSystems'
import {
  useDailyAggregations,
  useWeeklyAggregations,
  useMonthlyAggregations,
} from '@/hooks/queries/useAggregations'

const mockSystems = [{ id: 1, system_name: 'sys1', display_name: '시스템1' }]
const mockAgg = [{ id: 1, system_id: 1, created_at: '2026-01-01T00:00:00Z' }]

function renderPage(url = '/reports') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSystems).mockReturnValue({ data: mockSystems } as never)
    vi.mocked(useDailyAggregations).mockReturnValue({ data: mockAgg, isLoading: false } as never)
    vi.mocked(useWeeklyAggregations).mockReturnValue({ data: [], isLoading: false } as never)
    vi.mocked(useMonthlyAggregations).mockReturnValue({ data: [], isLoading: false } as never)
  })

  it('제목 렌더링', () => {
    renderPage()
    expect(screen.getByText('안정성 리포트')).toBeInTheDocument()
  })

  it('데이터 있을 때 AggregationCard 표시', () => {
    renderPage()
    expect(screen.getByTestId('aggregation-card')).toBeInTheDocument()
  })

  it('데이터 없을 때 빈 상태', () => {
    vi.mocked(useDailyAggregations).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByText('집계 데이터가 없습니다')).toBeInTheDocument()
  })

  it('로딩 상태', () => {
    vi.mocked(useDailyAggregations).mockReturnValue({ data: undefined, isLoading: true } as never)
    renderPage()
    expect(screen.getByText(/불러오는 중/)).toBeInTheDocument()
  })
})
