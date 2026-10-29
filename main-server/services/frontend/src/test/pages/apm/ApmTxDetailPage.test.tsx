import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApmTxDetailPage } from '@/pages/apm/ApmTxDetailPage'
import type { TxDetail, TxSummary } from '@/types/apm'

vi.mock('@/hooks/queries/useApmTransactionDetail', () => ({ useApmTransactionDetail: vi.fn() }))
vi.mock('@/hooks/queries/useSystems', () => ({ useSystems: vi.fn() }))
import { useSystems } from '@/hooks/queries/useSystems'
import { useApmTransactionDetail } from '@/hooks/queries/useApmTransactionDetail'

const mk = (over: Partial<TxSummary>): TxSummary =>
  ({
    trace_id: 't1',
    span_id: 's1',
    system_name: 'sys-a',
    instance_role: 'main',
    start_ts: '2026-10-30T01:00:00',
    uri: '/a',
    method: 'GET',
    status: 200,
    error: 0,
    exc_class: '',
    elapsed_ms: 100,
    conn_open: 4,
    conn_close: 3,
    conn_leak: 1,
    conn_uncommit: 0,
    user_ip: '10.0.0.*',
    user_id: 'ab****',
    ...over,
  }) as TxSummary

function setup(detail: TxDetail['detail'], slowMs?: number) {
  vi.mocked(useSystems).mockReturnValue({
    data: [{ id: 7, tx_slow_threshold_ms: slowMs }],
  } as never)
  const summary = mk({ system_id: 7 })
  vi.mocked(useApmTransactionDetail).mockReturnValue({
    data: {
      summary,
      sql: [],
      detail,
      path: [summary, mk({ span_id: 's2', system_name: 'sys-b', uri: '/b' })],
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as never)
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/apm/tx/t1/s1']}>
        <Routes>
          <Route path="/apm/tx/:traceId/:spanId" element={<ApmTxDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ApmTxDetailPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('경로 탭에 시스템 2개가 표시된다', () => {
    setup(null)
    expect(screen.getByText(/sys-a · main · \/a$/)).toBeInTheDocument()
    expect(screen.getByText(/sys-b · main/)).toBeInTheDocument()
  })

  it('detail=null 이면 호출 트리·스택 탭에 보관 정책 안내', async () => {
    setup(null, 5000)
    const text = '호출 트리는 느린 기준(5초) 이상·에러 건만 보관합니다'
    await userEvent.click(screen.getByRole('tab', { name: '호출 트리' }))
    expect(screen.getByText(text)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '스택 샘플' }))
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('임계값이 없으면 기본 3초', async () => {
    setup(null)
    await userEvent.click(screen.getByRole('tab', { name: '호출 트리' }))
    expect(
      screen.getByText('호출 트리는 느린 기준(3초) 이상·에러 건만 보관합니다'),
    ).toBeInTheDocument()
  })

  it('detail 이 있으면 호출 트리에 미계측 구간이 표시된다', async () => {
    setup({
      nodes: [
        { i: 0, p: -1, k: 'http', n: 'GET /a', s: 0, d: 100, sql_id: '' },
        { i: 1, p: 0, k: 'sql', n: 'select', s: 0, d: 10, sql_id: 'x' },
      ],
      stacks: [],
    })
    await userEvent.click(screen.getByRole('tab', { name: '호출 트리' }))
    expect(screen.getByText('미계측 구간')).toBeInTheDocument()
  })

  it('리소스 탭에 커넥션 수치 표시', async () => {
    setup(null)
    await userEvent.click(screen.getByRole('tab', { name: '리소스' }))
    expect(screen.getByText('미반환(leak)')).toBeInTheDocument()
  })
})
