import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SystemDetailPage } from '@/pages/SystemDetailPage'

vi.mock('@/hooks/queries/useSystems', () => ({ useSystem: vi.fn() }))
vi.mock('@/hooks/queries/useAggregations', () => ({
  useHourlyAggregations: vi.fn(),
  useTrendAlerts: vi.fn(),
}))
vi.mock('@/hooks/queries/useAlerts', () => ({ useAlerts: vi.fn() }))
vi.mock('@/components/charts/MetricChart', () => ({
  MetricChart: () => <div data-testid="metric-chart" />,
}))
vi.mock('@/components/contacts/SystemContactPanel', () => ({
  SystemContactPanel: () => <div data-testid="contact-panel" />,
}))
vi.mock('@/components/alert/AlertTable', () => ({
  AlertTable: ({ alerts }: { alerts: unknown[] }) => (
    <div data-testid="alert-table">알림 {alerts.length}개</div>
  ),
}))
vi.mock('@/components/alert/AlertDetailPanel', () => ({
  AlertDetailPanel: () => null,
}))

import { useSystem } from '@/hooks/queries/useSystems'
import { useHourlyAggregations, useTrendAlerts } from '@/hooks/queries/useAggregations'
import { useAlerts } from '@/hooks/queries/useAlerts'

const mockSystem = {
  id: 1,
  system_name: 'sys1',
  display_name: '시스템1',
  description: '테스트',
  host: '10.0.0.1',
  teams_webhook_url: null,
}

function renderPage(systemId = '1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/systems/${systemId}`]}>
        <Routes>
          <Route path="/systems/:systemId" element={<SystemDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SystemDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useHourlyAggregations).mockReturnValue({ data: [] } as never)
    vi.mocked(useTrendAlerts).mockReturnValue({ data: [] } as never)
    vi.mocked(useAlerts).mockReturnValue({ data: [] } as never)
  })

  it('로딩 상태', () => {
    vi.mocked(useSystem).mockReturnValue({ data: null, isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('시스템 없음 메시지', () => {
    vi.mocked(useSystem).mockReturnValue({ data: null, isLoading: false } as never)
    renderPage()
    expect(screen.getByText(/시스템을 찾을 수 없습니다/)).toBeInTheDocument()
  })

  it('시스템 상세 표시', () => {
    vi.mocked(useSystem).mockReturnValue({ data: mockSystem, isLoading: false } as never)
    renderPage()
    expect(screen.getAllByText('시스템1').length).toBeGreaterThan(0)
  })

  it('탭 렌더링', () => {
    vi.mocked(useSystem).mockReturnValue({ data: mockSystem, isLoading: false } as never)
    renderPage()
    expect(screen.getByRole('button', { name: '메트릭' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '알림' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '담당자' })).toBeInTheDocument()
  })
})
