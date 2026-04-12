import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FeedbackPage } from '@/pages/FeedbackPage'

vi.mock('@/hooks/queries/useAlerts', () => ({ useAlerts: vi.fn() }))
vi.mock('@/hooks/queries/useSystems', () => ({ useSystems: vi.fn() }))
vi.mock('@/components/alert/AlertTable', () => ({
  AlertTable: ({ alerts }: { alerts: unknown[] }) => (
    <div data-testid="alert-table">알림 {alerts.length}개</div>
  ),
}))
vi.mock('@/components/alert/AlertDetailPanel', () => ({
  AlertDetailPanel: ({ alert }: { alert: unknown }) =>
    alert ? <div data-testid="detail-panel" /> : null,
}))

import { useAlerts } from '@/hooks/queries/useAlerts'
import { useSystems } from '@/hooks/queries/useSystems'

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FeedbackPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('FeedbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSystems).mockReturnValue({ data: [] } as never)
  })

  it('로딩 상태', () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('오류 상태', () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error(),
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText(/다시 시도/i)).toBeInTheDocument()
  })

  it('피드백 관리 제목 표시', () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText('피드백 관리')).toBeInTheDocument()
  })

  it('요약 통계 카드 표시', () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText('전체 분석 건수')).toBeInTheDocument()
    expect(screen.getByText('피드백 제출 가능')).toBeInTheDocument()
    expect(screen.getByText('확인 처리 완료')).toBeInTheDocument()
  })
})
