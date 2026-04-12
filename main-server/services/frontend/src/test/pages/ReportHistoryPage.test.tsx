import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReportHistoryPage } from '@/pages/ReportHistoryPage'

vi.mock('@/hooks/queries/useReports', () => ({ useReports: vi.fn() }))

import { useReports } from '@/hooks/queries/useReports'

const mockReports = [
  {
    id: 1,
    report_type: 'daily',
    period_start: '2026-01-01T00:00:00Z',
    period_end: '2026-01-01T23:59:59Z',
    sent_at: '2026-01-02T08:00:00Z',
    teams_status: 'sent',
    system_count: 5,
    llm_summary: '정상 운영',
  },
  {
    id: 2,
    report_type: 'weekly',
    period_start: '2026-01-01T00:00:00Z',
    period_end: '2026-01-07T23:59:59Z',
    sent_at: '2026-01-08T08:00:00Z',
    teams_status: 'failed',
    system_count: null,
    llm_summary: 'A'.repeat(100), // 긴 요약 (툴팁 테스트용)
  },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReportHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ReportHistoryPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('로딩 스켈레톤', () => {
    vi.mocked(useReports).mockReturnValue({ data: [], isLoading: true } as never)
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('빈 목록', () => {
    vi.mocked(useReports).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByText('발송 이력이 없습니다')).toBeInTheDocument()
  })

  it('발송 이력 렌더링', () => {
    vi.mocked(useReports).mockReturnValue({ data: mockReports, isLoading: false } as never)
    renderPage()
    expect(screen.getByText('발송 완료')).toBeInTheDocument()
    expect(screen.getByText('발송 실패')).toBeInTheDocument()
  })

  it('리포트 발송 이력 제목', () => {
    vi.mocked(useReports).mockReturnValue({ data: [], isLoading: false } as never)
    renderPage()
    expect(screen.getByText('리포트 발송 이력')).toBeInTheDocument()
  })
})
