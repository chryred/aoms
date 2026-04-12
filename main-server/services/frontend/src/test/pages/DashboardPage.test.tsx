import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardPage } from '@/pages/DashboardPage'

vi.mock('@/hooks/queries/useDashboardHealth', () => ({ useDashboardHealth: vi.fn() }))
vi.mock('@/hooks/queries/useAgents', () => ({ useAgentHealthSummary: vi.fn() }))
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocketDashboard: vi.fn(),
}))
vi.mock('@/components/dashboard/DashboardSummary', () => ({
  DashboardSummaryStats: () => <div data-testid="summary-stats" />,
  DashboardLogAnalysisSummary: () => <div data-testid="log-summary" />,
  AgentHealthSummaryCard: () => <div data-testid="agent-health-summary" />,
}))
vi.mock('@/components/dashboard/SystemHealthGrid', () => ({
  SystemHealthGrid: ({ systems }: { systems: unknown[] }) => (
    <div data-testid="system-health-grid">시스템 {systems.length}개</div>
  ),
}))

import { useDashboardHealth } from '@/hooks/queries/useDashboardHealth'
import { useAgentHealthSummary } from '@/hooks/queries/useAgents'
import { useWebSocketDashboard } from '@/hooks/useWebSocket'

const mockDashboardData = {
  summary: {
    total_systems: 3,
    critical_systems: 1,
    warning_systems: 1,
    healthy_systems: 1,
    last_updated: '2026-01-01T00:00:00Z',
    total_active_alerts: 2,
    unacknowledged_alerts: 1,
    recent_log_analyses: 5,
    log_analyses_24h: 3,
  },
  systems: [{ id: 1, system_name: 'sys1', display_name: '시스템1', overall_status: 'critical' }],
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useWebSocketDashboard).mockReturnValue({
      isConnected: false,
      isConnecting: false,
    } as never)
    vi.mocked(useAgentHealthSummary).mockReturnValue({ data: undefined } as never)
  })

  it('로딩 상태', () => {
    vi.mocked(useDashboardHealth).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('오류 상태', () => {
    vi.mocked(useDashboardHealth).mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error(),
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('대시보드 데이터 표시', () => {
    vi.mocked(useDashboardHealth).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByTestId('summary-stats')).toBeInTheDocument()
    expect(screen.getByTestId('system-health-grid')).toBeInTheDocument()
  })

  it('WebSocket 연결 중 상태', () => {
    vi.mocked(useDashboardHealth).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useWebSocketDashboard).mockReturnValue({
      isConnected: false,
      isConnecting: true,
    } as never)
    renderPage()
    expect(screen.getByText(/실시간 연결 중/)).toBeInTheDocument()
  })

  it('WebSocket 연결됨 상태', () => {
    vi.mocked(useDashboardHealth).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useWebSocketDashboard).mockReturnValue({
      isConnected: true,
      isConnecting: false,
    } as never)
    renderPage()
    expect(screen.getByText(/실시간 알림 수신 중/)).toBeInTheDocument()
  })

  it('새로고침 버튼', async () => {
    const refetch = vi.fn().mockResolvedValue({})
    vi.mocked(useDashboardHealth).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
      refetch,
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /새로고침/ }))
    expect(refetch).toHaveBeenCalled()
  })
})
