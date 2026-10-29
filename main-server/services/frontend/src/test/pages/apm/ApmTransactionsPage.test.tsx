import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApmTransactionsPage } from '@/pages/apm/ApmTransactionsPage'
import type { TxSummary } from '@/types/apm'

vi.mock('@/hooks/queries/useApmTransactions', () => ({ useApmTransactions: vi.fn() }))
vi.mock('@/hooks/queries/useSystems', () => ({ useSystems: vi.fn() }))

import { useApmTransactions } from '@/hooks/queries/useApmTransactions'
import { useSystems } from '@/hooks/queries/useSystems'

const tx = {
  trace_id: 't1',
  span_id: 's1',
  system_id: 1,
  system_name: 'sys1',
  instance_role: 'main',
  start_ts: '2026-10-30T01:00:00',
  uri: '/order/list',
  method: 'GET',
  status: 200,
  error: 0,
  exc_class: '',
  elapsed_ms: 3500,
  cpu_ms: 10,
  sql_ms: 2000,
  sql_cnt: 3,
  fetch_cnt: 5,
  fetch_ms: 7,
  user_ip: '10.253.21.*',
  user_id: 'ab****',
  has_detail: 1,
} as TxSummary

function renderPage(url = '/apm/transactions') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/apm/transactions" element={<ApmTransactionsPage />} />
          <Route path="/apm/tx/:traceId/:spanId" element={<div>상세 이동됨</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ApmTransactionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSystems).mockReturnValue({
      data: [{ id: 1, system_name: 'sys1', display_name: '시스템1' }],
    } as never)
    vi.mocked(useApmTransactions).mockReturnValue({
      data: { items: [tx], has_more: false },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
  })

  it('필터 입력 후 조회하면 훅 인자에 min_elapsed_ms 가 반영되고 IP 는 마스킹 값 그대로 표시', async () => {
    renderPage()
    expect(screen.getByText('10.253.21.*')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('응답시간 > (ms)'), '3000')
    await userEvent.click(screen.getByRole('button', { name: '조회' }))
    const last = vi.mocked(useApmTransactions).mock.calls.at(-1)![0]
    expect(last.min_elapsed_ms).toBe(3000)
    expect(last.system_ids).toEqual([1])
  })

  it('URL 쿼리스트링이 필터에 반영된다', () => {
    renderPage('/apm/transactions?uri=/order&error_only=1&from=2026-10-30&to=2026-10-30')
    const p = vi.mocked(useApmTransactions).mock.calls.at(-1)![0]
    expect(p.uri).toBe('/order')
    expect(p.error_only).toBe(true)
    expect(p.start).toBe('2026-10-29T15:00:00')
    expect(p.end).toBe('2026-10-30T15:00:00')
  })

  it('행 클릭 시 상세로 이동', async () => {
    renderPage()
    await userEvent.click(screen.getByText('/order/list'))
    expect(screen.getByText('상세 이동됨')).toBeInTheDocument()
  })
})
