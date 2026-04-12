import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardSystemDetailPage } from '@/pages/DashboardSystemDetailPage'

vi.mock('@/hooks/queries/useDashboardHealth', () => ({
  useSystemDetailHealth: vi.fn(),
}))

import { useSystemDetailHealth } from '@/hooks/queries/useDashboardHealth'

const mockDetail = {
  system_id: 1,
  system_name: 'sys1',
  display_name: '시스템1',
  overall_status: 'critical',
  last_updated: '2026-01-01T00:00:00Z',
  metric_alerts: [],
  log_analysis: {
    latest_count: 0,
    critical_count: 0,
    warning_count: 0,
    incidents: [],
  },
  trend_alerts: [],
  proactive_alerts: [],
  contacts: [],
}

function renderPage(systemId = '1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/dashboard/systems/${systemId}`]}>
        <Routes>
          <Route path="/dashboard/systems/:systemId" element={<DashboardSystemDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardSystemDetailPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('로딩 상태', () => {
    vi.mocked(useSystemDetailHealth).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('오류 상태', () => {
    vi.mocked(useSystemDetailHealth).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error(),
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('시스템 상세 표시', () => {
    vi.mocked(useSystemDetailHealth).mockReturnValue({
      data: mockDetail,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText('시스템1')).toBeInTheDocument()
  })

  it('systemId 없을 때 안내 메시지', () => {
    vi.mocked(useSystemDetailHealth).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    // Routes에서 systemId 없이 렌더링
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DashboardSystemDetailPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText('시스템을 선택해주세요')).toBeInTheDocument()
  })
})
