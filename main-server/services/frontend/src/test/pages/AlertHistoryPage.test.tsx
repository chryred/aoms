import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AlertHistoryPage } from '@/pages/AlertHistoryPage'

vi.mock('@/hooks/queries/useAlerts', () => ({ useAlerts: vi.fn() }))
vi.mock('@/components/alert/AlertTable', () => ({
  AlertTable: ({ alerts, onSelect }: { alerts: unknown[]; onSelect: (a: unknown) => void }) => (
    <div data-testid="alert-table">
      <span>알림 {alerts.length}개</span>
      <button onClick={() => onSelect({ id: 1, qdrant_point_id: null })}>선택</button>
    </div>
  ),
}))
vi.mock('@/components/alert/AlertDetailPanel', () => ({
  AlertDetailPanel: ({ alert, onClose }: { alert: unknown; onClose: () => void }) =>
    alert ? (
      <div data-testid="alert-detail-panel">
        <button onClick={onClose}>닫기</button>
      </div>
    ) : null,
}))

import { useAlerts } from '@/hooks/queries/useAlerts'

const mockAlerts = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  alert_type: 'metric',
  severity: 'warning',
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AlertHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AlertHistoryPage', () => {
  beforeEach(() => vi.clearAllMocks())

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

  it('데이터 표시', () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: mockAlerts,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByTestId('alert-table')).toBeInTheDocument()
    expect(screen.getByText('알림 이력')).toBeInTheDocument()
  })

  it('탭 전환', async () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '메트릭' }))
    expect(useAlerts).toHaveBeenLastCalledWith(expect.objectContaining({ alert_type: 'metric' }))
  })

  it('알림 선택 → 상세 패널', async () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: mockAlerts,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '선택' }))
    expect(screen.getByTestId('alert-detail-panel')).toBeInTheDocument()
  })

  it('페이지네이션 — 이전/다음 버튼', () => {
    vi.mocked(useAlerts).mockReturnValue({
      data: mockAlerts,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByRole('button', { name: /이전/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /다음/ })).toBeDisabled()
  })
})
