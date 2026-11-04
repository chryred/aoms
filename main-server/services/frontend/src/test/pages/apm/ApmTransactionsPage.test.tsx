import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HTTPError } from 'ky'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApmTransactionsPage } from '@/pages/apm/ApmTransactionsPage'
import type { TxSummary } from '@/types/apm'

vi.mock('@/hooks/queries/useApmTransactions', () => ({ useApmTransactions: vi.fn() }))
vi.mock('@/hooks/queries/useSystems', () => ({ useSystems: vi.fn() }))
vi.mock('@/hooks/queries/useApmTxStats', () => ({ useApmTxStats: vi.fn() }))
vi.mock('@/hooks/queries/useApmTxHourly', () => ({ useApmTxHourly: vi.fn() }))
vi.mock('@/hooks/queries/useApmTransactionDetail', () => ({ useApmTransactionDetail: vi.fn() }))

import { useApmTransactions } from '@/hooks/queries/useApmTransactions'
import { useApmTransactionDetail } from '@/hooks/queries/useApmTransactionDetail'
import { useApmTxHourly } from '@/hooks/queries/useApmTxHourly'
import { useApmTxStats } from '@/hooks/queries/useApmTxStats'
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
  ext_ms: 0,
  ext_cnt: 0,
  host: 'was01',
} as TxSummary

const tx2 = {
  ...tx,
  trace_id: 't2',
  span_id: 's2',
  uri: '/cart/add',
  start_ts: '2026-10-30T01:10:00',
  elapsed_ms: 100,
  sql_ms: 10,
  error: 0,
} as TxSummary
const tx3 = {
  ...tx,
  trace_id: 't3',
  span_id: 's3',
  uri: '/pay/fail',
  start_ts: '2026-10-30T01:20:00',
  elapsed_ms: 800,
  sql_ms: 50,
  error: 1,
  exc_class: 'java.lang.Boom',
} as TxSummary

const statsItem = {
  uri: '/order/list',
  count: 40,
  error_count: 2,
  ratio: 40,
  elapsed_max: 5000,
  elapsed_avg: 1200,
  sql_max: 900,
  sql_avg: 300,
  ext_max: 0,
  ext_avg: 0,
  ap_avg: 900,
}

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
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(useSystems).mockReturnValue({
      data: [{ id: 1, system_name: 'sys1', display_name: '시스템1' }],
    } as never)
    vi.mocked(useApmTransactions).mockReturnValue({
      data: { items: [tx, tx2, tx3], has_more: false, counts: { total: 3, normal: 2, error: 1 } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    vi.mocked(useApmTxStats).mockReturnValue({
      data: { items: [statsItem, { ...statsItem, uri: '/cart/add', count: 5 }], total: 2 },
      isLoading: false,
      error: null,
    } as never)
    vi.mocked(useApmTxHourly).mockReturnValue({
      data: {
        items: [
          { hour: '09', count: 12, elapsed_avg: 300, sql_avg_per_exec: 20 },
          { hour: '10', count: 30, elapsed_avg: 500, sql_avg_per_exec: 40 },
        ],
      },
      isLoading: false,
      error: null,
    } as never)
    vi.mocked(useApmTransactionDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as never)
  })

  const lastParams = () => vi.mocked(useApmTransactions).mock.calls.at(-1)![0]
  const rows = () => screen.getAllByTestId('tx-row')
  const listCell = (text: string) =>
    rows()
      .flatMap((r) => [...r.querySelectorAll('td')])
      .find((td) => td.textContent === text)

  it('필터 입력 후 조회하면 훅 인자에 min_elapsed_ms 가 반영되고 IP 는 마스킹 값 그대로 표시', async () => {
    renderPage()
    expect(screen.getAllByText('10.253.21.*').length).toBeGreaterThan(0)
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

  it('422 는 보관 기간 안내를 즉시 표시한다 (선택 시스템 보관일 최대값)', () => {
    vi.mocked(useSystems).mockReturnValue({
      data: [
        { id: 1, display_name: 'a', tx_retention_days: 7 },
        { id: 2, display_name: 'b', tx_retention_days: 14 },
      ],
    } as never)
    const err = new HTTPError(
      new Response('{}', { status: 422 }),
      new Request('http://x/api'),
      {} as never,
    )
    vi.mocked(useApmTransactions).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: err,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText('보관 기간(14일) 지난 데이터입니다')).toBeInTheDocument()
    expect(screen.queryByText('다시 시도')).not.toBeInTheDocument()
  })

  it('시작일이 종료일보다 늦으면 조회하지 않고 검증 메시지를 표시한다', async () => {
    renderPage()
    vi.mocked(useApmTransactions).mockClear()
    fireEvent.change(screen.getByLabelText('시작일 (KST)'), { target: { value: '2999-01-01' } })
    await userEvent.click(screen.getByRole('button', { name: '조회' }))
    expect(screen.getByText('시작일이 종료일보다 늦을 수 없습니다')).toBeInTheDocument()
  })

  it('URL 의 잘못된 날짜는 API 호출 대상이 비어 있다', () => {
    renderPage('/apm/transactions?from=2026-10-31&to=2026-10-30')
    expect(vi.mocked(useApmTransactions).mock.calls.at(-1)![0].system_ids).toEqual([])
    expect(screen.getAllByText('시작일이 종료일보다 늦을 수 없습니다').length).toBeGreaterThan(0)
  })

  it('산점도 영역 선택 URL(from/to ISO, min_ms/max_ms, system, instance)을 읽어 자동 조회한다', () => {
    renderPage(
      '/apm/transactions?from=2026-11-04T00:40:00Z&to=2026-11-04T00:42:00Z&min_ms=500&max_ms=2000&system=1&instance=main',
    )
    const p = vi.mocked(useApmTransactions).mock.calls.at(-1)![0]
    expect(p.start).toBe('2026-11-04T00:40:00')
    expect(p.end).toBe('2026-11-04T00:42:00')
    expect(p.min_elapsed_ms).toBe(500)
    expect(p.max_elapsed_ms).toBe(2000)
    expect(p.system_ids).toEqual([1])
    expect(p.instance_role).toBe('main')
    expect(screen.getByLabelText('시작 시각 (KST, 선택)')).toHaveValue('09:40:00')
    expect(screen.getByLabelText('종료 시각 (KST, 선택)')).toHaveValue('09:42:00')
    expect(screen.getByLabelText('응답시간 < (ms)')).toHaveValue(2000)
    expect(screen.getByLabelText('응답시간 > (ms)')).toHaveValue(500)
  })

  it('새 레이아웃: 응답 시간 차트, 좌하단 탭 3종, 건수 칩(API counts)', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: '응답 시간 차트' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      '트랜잭션별 통계',
      '트랜잭션 차트',
      '콜 트리',
    ])
    const chip = (label: string) =>
      screen.getByText(label, { selector: 'span.text-text-secondary' }).parentElement!
    expect(chip('전체')).toHaveTextContent('3')
    expect(chip('정상')).toHaveTextContent('2')
    expect(chip('에러')).toHaveTextContent('1')
    expect(screen.getAllByTestId('tx-dot')).toHaveLength(2)
    expect(screen.getAllByTestId('tx-dot-error')).toHaveLength(1)
  })

  it('검색 패널: 상세 토글로 추가 조건이 보이고 조회 시 파라미터에 반영된다', async () => {
    renderPage()
    expect(screen.queryByLabelText('Fetch Count ≥')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '상세' }))
    await userEvent.type(screen.getByLabelText('Fetch Count ≥'), '5')
    await userEvent.type(screen.getByLabelText('SQL 실행 ≥'), '7')
    await userEvent.type(screen.getByLabelText('Open Conn ≥'), '2')
    await userEvent.type(screen.getByLabelText('거래 키'), 'ORD-9')
    await userEvent.type(screen.getByLabelText('TID (span_id)'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: '에러만' }))
    await userEvent.click(screen.getByRole('button', { name: '조회' }))
    const p = lastParams()
    expect(p).toMatchObject({
      min_fetch_cnt: 5,
      min_sql_cnt: 7,
      min_conn_open: 2,
      biz_key: 'ORD-9',
      span_id: 'abc',
      error_only: true,
    })
  })

  it('기본 정렬은 수행 시간 내림차순이며 헤더 클릭으로 서버 정렬 파라미터가 바뀐다', async () => {
    renderPage()
    expect(lastParams()).toMatchObject({ order_by: 'elapsed_ms', order: 'desc', limit: 100 })
    await userEvent.click(screen.getByRole('button', { name: /수행 시간\(ms\)/ }))
    expect(lastParams()).toMatchObject({ order_by: 'elapsed_ms', order: 'asc' })
    await userEvent.click(screen.getByRole('button', { name: /SQL\(ms\)/ }))
    expect(lastParams()).toMatchObject({ order_by: 'sql_ms', order: 'desc' })
    expect(screen.getByRole('columnheader', { name: /SQL\(ms\)/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('정렬을 바꿔도 조회 조건은 유지되고, 조회하면 정렬이 유지된다', async () => {
    renderPage(
      '/apm/transactions?uri=/order&from=2026-10-30&to=2026-10-30&order_by=cpu_ms&order=asc',
    )
    expect(lastParams()).toMatchObject({ uri: '/order', order_by: 'cpu_ms', order: 'asc' })
    await userEvent.click(screen.getByRole('button', { name: '조회' }))
    expect(lastParams()).toMatchObject({ order_by: 'cpu_ms', order: 'asc' })
  })

  it('페이징: 처음/이전/다음/마지막이 offset 을 바꾼다 (total 로 총 페이지 계산)', async () => {
    vi.mocked(useApmTransactions).mockReturnValue({
      data: { items: [tx], has_more: true, counts: { total: 250, normal: 249, error: 1 } },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as never)
    renderPage()
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '첫 페이지' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(lastParams().offset).toBe(100)
    await userEvent.click(screen.getByRole('button', { name: '마지막 페이지' }))
    expect(lastParams().offset).toBe(200)
    await userEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(lastParams().offset).toBe(100)
    await userEvent.click(screen.getByRole('button', { name: '첫 페이지' }))
    expect(lastParams().offset).toBe(0)
  })

  it('단일 클릭은 선택(산점도 강조), 더블클릭은 상세를 새 탭 경로로 연다', async () => {
    renderPage()
    expect(screen.queryByTestId('tx-dot-selected')).not.toBeInTheDocument()
    await userEvent.click(listCell('/cart/add')!)
    expect(screen.queryByText('상세 이동됨')).not.toBeInTheDocument()
    expect(rows().find((r) => r.textContent?.includes('/cart/add'))).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByTestId('tx-dot-selected')).toBeInTheDocument()
    await userEvent.dblClick(listCell('/order/list')!)
    expect(screen.getByText('상세 이동됨')).toBeInTheDocument()
  })

  it('Enter 키로도 상세를 연다', async () => {
    renderPage()
    rows()[0].focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByText('상세 이동됨')).toBeInTheDocument()
  })

  it('AP 시간(응답-SQL-외부)과 종료 시각(KST)을 파생해 표시한다', () => {
    renderPage()
    const row = rows().find((r) => r.textContent?.includes('/order/list'))!
    const cells = within(row).getAllByRole('cell')
    // 시작 10:00:00.000 + 3.5초 = 10:00:03.500
    expect(cells[0]).toHaveTextContent('10:00:03.500')
    expect(cells[3]).toHaveTextContent('10:00:00.000')
    expect(cells[5]).toHaveTextContent('1,500') // 3500 - 2000
    // 보조 열(fetch·외부·사용자·호스트)은 기본 숨김 → 열 10개
    expect(cells).toHaveLength(10)
    expect(screen.queryByRole('columnheader', { name: '호스트' })).not.toBeInTheDocument()
  })

  it('열 선택: 보조 열을 켜면 표시되고 localStorage 에 유지된다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /열 선택/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: '호스트' }))
    expect(screen.getByRole('columnheader', { name: '호스트' })).toBeInTheDocument()
    const row = rows().find((r) => r.textContent?.includes('/order/list'))!
    expect(row).toHaveTextContent('was01')
    expect(JSON.parse(localStorage.getItem('synapse.apmTx.hiddenCols.anon') ?? '[]')).not.toContain(
      'host',
    )
  })

  it('에러 배지는 수행 시간 숫자와 별도 슬롯에 있다', () => {
    renderPage()
    const row = rows().find((r) => r.textContent?.includes('/pay/fail'))!
    const badge = within(row).getByText('에러')
    expect(badge.closest('td')).toBe(within(row).getByText('800').closest('td'))
    expect(badge.parentElement).not.toBe(within(row).getByText('800').parentElement)
  })

  it('트랜잭션별 통계 탭: URI 별 집계를 보여주고, 행 클릭 시 목록을 그 URI 로 좁힌다', async () => {
    renderPage()
    const statsRows = screen.getAllByTestId('stats-row')
    expect(statsRows).toHaveLength(2)
    expect(statsRows[0]).toHaveTextContent('/order/list')
    expect(statsRows[0]).toHaveTextContent('40')
    expect(statsRows[0]).toHaveTextContent('40.0%')
    expect(vi.mocked(useApmTxStats).mock.calls.at(-1)![0]).toMatchObject({ limit: 50 })
    await userEvent.click(statsRows[1])
    expect(lastParams().uri).toBe('/cart/add')
    expect(screen.getByRole('button', { name: 'URI 필터 해제' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'URI 필터 해제' }))
    expect(lastParams().uri).toBeUndefined()
  })

  it('통계 표 헤더로 정렬한다', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /^건수/ }))
    const first = () => screen.getAllByTestId('stats-row')[0]
    expect(first()).toHaveTextContent('/cart/add')
    await userEvent.click(screen.getByRole('button', { name: /^건수/ }))
    expect(first()).toHaveTextContent('/order/list')
  })

  it('트랜잭션 차트 탭: 시간대별 막대를 그린다 (통계 탭이 아닐 때만 조회)', async () => {
    renderPage()
    expect(vi.mocked(useApmTxHourly).mock.calls.at(-1)![1]).toBe(false)
    await userEvent.click(screen.getByRole('tab', { name: '트랜잭션 차트' }))
    expect(vi.mocked(useApmTxHourly).mock.calls.at(-1)![1]).toBe(true)
    expect(screen.getByTestId('hourly-bar-10')).toBeInTheDocument()
    expect(screen.getByTestId('hourly-bar-00')).toBeInTheDocument()
    expect(screen.getByTestId('hourly-bar-23')).toBeInTheDocument()
    expect(screen.getByText('KST')).toBeInTheDocument()
  })

  it('콜 트리 탭: 선택 전에는 안내, 선택 후에는 선택 건의 콜 트리 요약', async () => {
    vi.mocked(useApmTransactionDetail).mockImplementation(
      (traceId) =>
        ({
          data: traceId
            ? {
                summary: tx,
                sql: [],
                path: [],
                detail: {
                  nodes: [
                    { i: 0, p: -1, k: 'http', n: 'GET /order/list', s: 0, d: 3500, sql_id: '' },
                  ],
                  stacks: [],
                },
              }
            : undefined,
          isLoading: false,
        }) as never,
    )
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: '콜 트리' }))
    expect(screen.getByText('목록에서 트랜잭션을 선택하세요')).toBeInTheDocument()
    await userEvent.click(listCell('/order/list')!)
    expect(screen.getByTestId('call-tree')).toHaveTextContent('GET /order/list')
  })

  it('산점도 드래그로 영역을 고르면 목록이 그 영역으로 좁혀지고 칩으로 해제한다', async () => {
    renderPage()
    expect(rows()).toHaveLength(3)
    const overlay = screen.getByTestId('tx-scatter-overlay')
    // 응답 100·800ms 점(아래쪽)만 포함, 3500ms 점은 제외
    fireEvent.mouseDown(overlay, { clientX: 40, clientY: 150 })
    fireEvent.mouseMove(overlay, { clientX: 200, clientY: 190 })
    fireEvent.mouseUp(overlay, { clientX: 300, clientY: 200 })
    expect(rows()).toHaveLength(2)
    expect(listCell('/order/list')).toBeUndefined()
    expect(screen.getByTestId('tx-brush')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '선택 영역 해제' }))
    expect(rows()).toHaveLength(3)
    expect(screen.queryByTestId('tx-brush')).not.toBeInTheDocument()
  })

  it('아주 짧은 드래그(클릭)는 영역으로 취급하지 않는다', () => {
    renderPage()
    const overlay = screen.getByTestId('tx-scatter-overlay')
    fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(overlay, { clientX: 101, clientY: 101 })
    expect(rows()).toHaveLength(3)
  })
})
