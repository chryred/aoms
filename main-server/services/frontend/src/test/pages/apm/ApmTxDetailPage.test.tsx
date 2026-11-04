import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
    biz_key: '',
    host: 'was01',
    system_id: 7,
    sql_ms: 0,
    sql_cnt: 0,
    ext_ms: 0,
    ext_cnt: 0,
    parent_span: '',
    ...over,
  }) as TxSummary

function setup(
  detail: TxDetail['detail'],
  slowMs?: number,
  extra: {
    sql?: TxDetail['sql']
    summary?: Partial<TxSummary>
    path?: TxSummary[]
    params?: TxDetail['params']
  } = {},
) {
  vi.mocked(useSystems).mockReturnValue({
    data: [{ id: 7, tx_slow_threshold_ms: slowMs }],
  } as never)
  const summary = mk({ system_id: 7, ...extra.summary })
  vi.mocked(useApmTransactionDetail).mockReturnValue({
    data: {
      summary,
      sql: extra.sql ?? [],
      detail,
      path: extra.path ?? [summary, mk({ span_id: 's2', system_name: 'sys-b', uri: '/b' })],
      params: extra.params ?? null,
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
    expect(screen.getAllByText(/sys-a · main/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/sys-b · main/).length).toBeGreaterThan(0)
  })

  it('detail=null 이면 호출 트리·스택 탭에 보관 정책 안내', async () => {
    setup(null, 5000)
    const text = '호출 트리는 느린 기준(5초) 이상·에러 건만 보관합니다'
    await userEvent.click(screen.getByRole('tab', { name: '콜 트리' }))
    expect(screen.getByText(text)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /액티브 내역/ }))
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('임계값이 없으면 기본 3초', async () => {
    setup(null)
    await userEvent.click(screen.getByRole('tab', { name: '콜 트리' }))
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
    await userEvent.click(screen.getByRole('tab', { name: '콜 트리' }))
    expect(screen.getByText('미계측 구간')).toBeInTheDocument()
  })

  it('리소스 탭에 커넥션 수치 표시', async () => {
    setup(null)
    await userEvent.click(screen.getByRole('tab', { name: '리소스' }))
    expect(screen.getByTestId('conn-status')).toHaveAttribute('data-state', 'critical')
  })

  const sqlRows = (): TxDetail['sql'] => [
    {
      sql_id: 'q1',
      sql_text: 'SELECT 1 FROM A',
      cnt: 2,
      ms: 40,
      max_ms: 30,
      fetch_cnt: 0,
      fetch_ms: 0,
      err: 0,
      db: 'ora-main',
    },
    {
      sql_id: 'q2',
      sql_text: 'UPDATE B SET X=1',
      cnt: 3,
      ms: 60,
      max_ms: 30,
      fetch_cnt: 0,
      fetch_ms: 0,
      err: 1,
      db: 'ora-sub',
    },
    {
      sql_id: 'q3',
      sql_text: 'DELETE FROM C',
      cnt: 1,
      ms: 5,
      max_ms: 5,
      fetch_cnt: 0,
      fetch_ms: 0,
      err: 0,
      db: '',
    },
  ]
  const treeNodes = (): NonNullable<TxDetail['detail']> => ({
    nodes: [
      { i: 0, p: -1, k: 'http', n: 'GET /a', s: 0, d: 100, sql_id: '' },
      { i: 1, p: 0, k: 'sql', n: 'selectA', s: 0, d: 60, sql_id: 'q1' },
      { i: 2, p: 1, k: 'ext', n: 'inner-ext', s: 0, d: 30, sql_id: '' },
      { i: 3, p: 0, k: 'sql', n: 'tinySql', s: 60, d: 3, sql_id: 'q2' },
    ],
    stacks: [],
  })

  it('좌측 메뉴 8개와 예외 건수(트랜잭션 에러 + SQL 에러)를 표시한다', () => {
    setup(null, undefined, { sql: sqlRows(), summary: { error: 1, exc_class: 'java.lang.Boom' } })
    const names = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(names).toEqual([
      '트랜잭션 경로',
      'SQL 목록',
      '예외(에러)(2)',
      '메소드 통계',
      '사용자 전문',
      '콜 트리',
      '액티브 내역(스택 샘플)',
      '리소스',
    ])
    expect(screen.getByRole('tab', { name: '트랜잭션 경로' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('예외 메뉴: 에러가 없으면 빈 상태, 있으면 예외 클래스', async () => {
    setup(null)
    await userEvent.click(screen.getByRole('tab', { name: /예외\(에러\)/ }))
    expect(screen.getByText('발생한 예외가 없습니다')).toBeInTheDocument()
  })

  it('예외 메뉴: 예외 클래스를 보여준다', async () => {
    setup(null, undefined, { summary: { error: 1, exc_class: 'java.lang.Boom' } })
    await userEvent.click(screen.getByRole('tab', { name: /예외\(에러\)/ }))
    expect(screen.getAllByText('java.lang.Boom').length).toBeGreaterThan(0)
  })

  it('헤더: 큰 URI, KST 시작 시각(ms), 거래 키 배지, 상세 정보 팝오버', async () => {
    setup(null, undefined, { sql: sqlRows(), summary: { biz_key: 'ORD-1' } })
    expect(screen.getByRole('heading', { name: '/a' })).toBeInTheDocument()
    expect(screen.getByText(/시작 10:00:00\.000/)).toBeInTheDocument()
    expect(screen.getByText('거래키 ORD-1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /상세 정보/ }))
    const pop = screen.getByRole('dialog', { name: '트랜잭션 상세 정보' })
    expect(within(pop).getByText(/sys-a \/ main/)).toBeInTheDocument()
    expect(within(pop).getByText(/호스트 was01/)).toBeInTheDocument()
    expect(within(pop).getByText('ora-main, ora-sub')).toBeInTheDocument()
    expect(within(pop).getByText(/^s1/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  describe('트랜잭션 경로 다이어그램', () => {
    it('클라이언트 IP, WAS(Elapse/AP/SQL/Remote/Count), db 별 DB 노드를 그린다', () => {
      setup(null, undefined, {
        sql: sqlRows(),
        summary: { elapsed_ms: 200, sql_ms: 105, sql_cnt: 6, ext_ms: 20 },
        path: [],
      })
      expect(within(screen.getByTestId('diagram-ip')).getByText('IP 10.0.0.*')).toBeInTheDocument()
      const was = screen.getByTestId('diagram-was')
      expect(within(was).getByText('sys-a · main')).toBeInTheDocument()
      expect(within(was).getByText('Elapse').nextSibling).toHaveTextContent('200ms')
      expect(within(was).getByText('AP').nextSibling).toHaveTextContent('75ms')
      expect(within(was).getByText('SQL').nextSibling).toHaveTextContent('105ms')
      expect(within(was).getByText('Remote').nextSibling).toHaveTextContent('20ms')
      expect(within(was).getByText('Count').nextSibling).toHaveTextContent('1')
      const dbs = screen.getAllByTestId('diagram-db')
      expect(dbs).toHaveLength(3)
      expect(dbs.map((d) => d.querySelector('p')?.textContent)).toEqual([
        'ora-main',
        'ora-sub',
        'DB',
      ])
      expect(within(dbs[0]).getByText('Exec').nextSibling).toHaveTextContent('2')
      expect(screen.getAllByTestId('diagram-db-edge')[1]).toHaveTextContent('60ms / 3')
    })

    it('DB 구간 숨김 체크 시 DB 노드가 사라진다', async () => {
      setup(null, undefined, { sql: sqlRows(), path: [] })
      expect(screen.getAllByTestId('diagram-db').length).toBeGreaterThan(0)
      await userEvent.click(screen.getByRole('checkbox', { name: 'DB 구간 숨김' }))
      expect(screen.queryByTestId('diagram-db')).not.toBeInTheDocument()
      expect(screen.getByTestId('diagram-was')).toBeInTheDocument()
    })

    it('콜 트리 배지를 누르면 콜 트리 메뉴로 이동한다', async () => {
      setup(treeNodes(), undefined, { path: [] })
      await userEvent.click(screen.getByRole('button', { name: '콜 트리' }))
      expect(screen.getByRole('tab', { name: '콜 트리' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('call-tree')).toBeInTheDocument()
    })

    it('분산 호출: 부모-자식 span 이 원격 엣지로 이어지고, 시간축은 아래에 유지된다', () => {
      const root = mk({ span_id: 's1', system_id: 7, ext_ms: 40, ext_cnt: 1 })
      const child = mk({
        span_id: 's2',
        parent_span: 's1',
        system_name: 'sys-b',
        uri: '/b',
        elapsed_ms: 35,
      })
      setup(null, undefined, { path: [root, child] })
      expect(screen.getAllByTestId('diagram-was')).toHaveLength(2)
      expect(screen.getByTestId('diagram-remote-edge')).toHaveTextContent('외부 40ms / 1')
      expect(screen.getByText('시간축')).toBeInTheDocument()
    })
  })

  describe('콜 트리', () => {
    const open = async () => {
      setup(treeNodes(), undefined, { sql: sqlRows(), path: [] })
      await userEvent.click(screen.getByRole('tab', { name: '콜 트리' }))
    }

    it('종류 배지(HTTP/SQL/EXT)를 표시한다', async () => {
      await open()
      const tree = screen.getByTestId('call-tree')
      expect(within(tree).getByText('HTTP')).toBeInTheDocument()
      expect(within(tree).getAllByText('SQL')).toHaveLength(2)
      expect(within(tree).getByText('EXT')).toBeInTheDocument()
    })

    it('노드별 접기/펼치기', async () => {
      await open()
      expect(screen.getByText('inner-ext')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '접기 selectA' }))
      expect(screen.queryByText('inner-ext')).not.toBeInTheDocument()
      expect(screen.getByText('tinySql')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '펼치기 selectA' }))
      expect(screen.getByText('inner-ext')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '모두 접기' }))
      expect(screen.queryByText('selectA')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '모두 펼치기' }))
      expect(screen.getByText('selectA')).toBeInTheDocument()
    })

    it('수행 시간 N% 이하 숨기기', async () => {
      await open()
      expect(screen.getByText('tinySql')).toBeInTheDocument()
      const input = screen.getByLabelText('숨길 수행 시간 비율(%)')
      await userEvent.clear(input)
      await userEvent.type(input, '5')
      expect(screen.queryByText('tinySql')).not.toBeInTheDocument()
      expect(screen.getByText('selectA')).toBeInTheDocument()
      expect(screen.getByText('GET /a')).toBeInTheDocument()
    })

    it('SQL 노드를 누르면 SQL 목록에서 해당 SQL 이 펼쳐진다', async () => {
      await open()
      await userEvent.click(screen.getByRole('button', { name: 'selectA' }))
      expect(screen.getByRole('tab', { name: 'SQL 목록' })).toHaveAttribute('aria-selected', 'true')
      const row = document.getElementById('sql-row-q1')!
      expect(within(row).getByRole('button', { expanded: true })).toBeInTheDocument()
      expect(within(row).getByTestId('sql-code')).toBeInTheDocument()
    })
  })

  it('SQL 목록: 평균 열과 정렬 토글을 표시한다', async () => {
    setup(null, undefined, { sql: sqlRows(), path: [] })
    await userEvent.click(screen.getByRole('tab', { name: 'SQL 목록' }))
    expect(screen.getByRole('button', { name: /평균/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '오래 걸린 순' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(screen.getByRole('button', { name: '실행 많은 순' }))
    expect(screen.getAllByTestId('sql-row')[0]).toHaveTextContent('UPDATE')
  })

  describe('메뉴 순서·메소드 통계·사용자 전문', () => {
    const stacks = [
      {
        f: [
          'com.a.Dao.query(Dao.java:1)',
          'com.a.Svc.run(Svc.java:2)',
          'java.lang.Thread.run(Thread.java:1)',
        ],
        c: 3,
      },
      { f: ['com.a.Svc.run(Svc.java:5)', 'java.lang.Thread.run(Thread.java:1)'], c: 1 },
    ]
    const nodes = [{ i: 0, p: -1, k: 'http', n: 'GET /a', s: 0, d: 100, sql_id: '' }]

    it('메소드 통계: inclusive/self/비율/추정 시간 집계, 필터·JDK 제외', async () => {
      setup({ nodes, stacks }, undefined, {
        summary: { elapsed_ms: 1000, sql_ms: 200, ext_ms: 200 },
      })
      await userEvent.click(screen.getByRole('tab', { name: '메소드 통계' }))
      let rows = screen.getAllByTestId('method-row')
      // Svc.run(4) = Thread.run(4) > Dao.query(3); inclusive desc
      expect(rows).toHaveLength(3)
      const svc = rows.find((r) => r.textContent?.includes('com.a.Svc.run'))!
      expect(svc).toHaveTextContent('100.0%')
      expect(svc).toHaveTextContent('600') // 4/4 × (1000-200-200)
      const dao = rows.find((r) => r.textContent?.includes('com.a.Dao.query'))!
      expect(dao).toHaveTextContent('75.0%')
      expect(dao).toHaveTextContent('450')
      expect(within(dao).getAllByRole('cell')[2]).toHaveTextContent('3') // self
      expect(within(svc).getAllByRole('cell')[2]).toHaveTextContent('1')
      await userEvent.click(screen.getByLabelText('JDK/프레임워크 제외'))
      rows = screen.getAllByTestId('method-row')
      expect(rows).toHaveLength(2)
      await userEvent.type(screen.getByLabelText('메소드 필터'), 'dao')
      expect(screen.getAllByTestId('method-row')).toHaveLength(1)
    })

    it('메소드 통계: 스택 샘플 없으면 안내', async () => {
      setup(null)
      await userEvent.click(screen.getByRole('tab', { name: '메소드 통계' }))
      expect(screen.getByText(/스택 샘플이 없는 트랜잭션입니다/)).toBeInTheDocument()
    })

    it('사용자 전문: 쿼리 스트링·파라미터·마스킹 배지·생략 안내', async () => {
      setup(null, undefined, {
        params: {
          q: 'a=1&token=****',
          p: [
            ['orderNo', 'ORD-1'],
            ['password', '****'],
          ],
          t: true,
        },
      })
      await userEvent.click(screen.getByRole('tab', { name: '사용자 전문' }))
      expect(screen.getByText('a=1&token=****')).toBeInTheDocument()
      const rows = screen.getAllByTestId('param-row')
      expect(rows).toHaveLength(2)
      expect(rows[0]).toHaveTextContent('ORD-1')
      expect(rows[1]).toHaveTextContent('마스킹됨')
      expect(rows[0]).not.toHaveTextContent('마스킹됨')
      expect(screen.getByText(/일부 생략됨/)).toBeInTheDocument()
    })

    it('사용자 전문: params 가 null 이면 안내', async () => {
      setup(null)
      await userEvent.click(screen.getByRole('tab', { name: '사용자 전문' }))
      expect(screen.getByText(/수집된 요청 파라미터가 없습니다/)).toBeInTheDocument()
    })
  })
})
