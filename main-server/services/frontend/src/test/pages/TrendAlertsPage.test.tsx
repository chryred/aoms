import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import _userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/hooks/queries/useTrendAlerts', () => ({ useTrendAlerts: vi.fn() }))
vi.mock('@/store/uiStore', () => ({
  useUiStore: vi.fn((selector: (s: object) => unknown) => selector({ criticalCount: 2 })),
}))

import { useTrendAlerts } from '@/hooks/queries/useTrendAlerts'

async function renderPage() {
  const { default: TrendAlertsPage } = await import('@/pages/TrendAlertsPage')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/trend-alerts']}>
        <TrendAlertsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const mockAlerts = [
  {
    id: 1,
    system_id: 1,
    system_name: 'sys1',
    llm_severity: 'critical',
    hour_bucket: '2026-01-01T00:00:00Z',
    metric_group: 'cpu',
    collector_type: 'synapse_agent',
    llm_prediction: '장애예측1',
    llm_summary: null,
  },
  {
    id: 2,
    system_id: 2,
    system_name: 'sys2',
    llm_severity: 'warning',
    hour_bucket: '2026-01-01T00:00:00Z',
    metric_group: 'memory',
    collector_type: 'synapse_agent',
    llm_prediction: '장애예측2',
    llm_summary: null,
  },
]

describe('TrendAlertsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('로딩 상태', async () => {
    vi.mocked(useTrendAlerts).mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
      dataUpdatedAt: 0,
    } as never)
    await renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('빈 목록 표시', async () => {
    vi.mocked(useTrendAlerts).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      dataUpdatedAt: 0,
    } as never)
    await renderPage()
    expect(screen.getByText(/현재 임박한 장애 예측이 없습니다/)).toBeInTheDocument()
  })

  it('오류 표시', async () => {
    vi.mocked(useTrendAlerts).mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
      dataUpdatedAt: 0,
    } as never)
    await renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('알림 목록 렌더링', async () => {
    vi.mocked(useTrendAlerts).mockReturnValue({
      data: mockAlerts,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      dataUpdatedAt: Date.now(),
    } as never)
    await renderPage()
    expect(screen.getByText('장애 예측 알림')).toBeInTheDocument()
  })

  it('필터 버튼 렌더링', async () => {
    vi.mocked(useTrendAlerts).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      dataUpdatedAt: 0,
    } as never)
    await renderPage()
    expect(screen.getByRole('button', { name: '전체' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Warning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Critical' })).toBeInTheDocument()
  })
})
