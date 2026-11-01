import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApmSummaryCard } from '@/components/apm/ApmSummaryCard'

vi.mock('@/api/apm', () => ({ apmApi: { getSystemSummary: vi.fn() } }))
import { apmApi } from '@/api/apm'

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ApmSummaryCard systemId={1} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ApmSummaryCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Agent-T 가 있으면 1시간 지표와 실시간 모니터링 링크를 표시한다', async () => {
    vi.mocked(apmApi.getSystemSummary).mockResolvedValue({
      has_agent_t: true,
      tps_1h: 12.34,
      avg_ms_1h: 250,
      slow_count_1h: 7,
      slow_threshold_ms: 3000,
    })
    renderCard()
    const link = await screen.findByRole('link', { name: '실시간 모니터링 열기' })
    expect(link).toHaveAttribute('href', '/apm/live?system=1')
    expect(screen.getByText('12.3')).toBeInTheDocument()
    expect(screen.getByText('250ms')).toBeInTheDocument()
    expect(screen.getByText('7건')).toBeInTheDocument()
  })

  it('Agent-T 가 없으면 설치 안내 링크를 표시한다', async () => {
    vi.mocked(apmApi.getSystemSummary).mockResolvedValue({
      has_agent_t: false,
      tps_1h: 0,
      avg_ms_1h: 0,
      slow_count_1h: 0,
      slow_threshold_ms: 3000,
    })
    renderCard()
    const link = await screen.findByRole('link', { name: /에이전트 관리에서 설치하기/ })
    expect(link).toHaveAttribute('href', '/agents')
    expect(screen.queryByRole('link', { name: '실시간 모니터링 열기' })).toBeNull()
  })
})
