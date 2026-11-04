import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HTTPError } from 'ky'

vi.mock('@/hooks/useApmLiveStream', () => ({ useApmLiveStream: vi.fn() }))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/api/apm', () => ({
  apmApi: {
    listDashboards: vi.fn(),
    createDashboard: vi.fn(),
    updateDashboard: vi.fn(),
    deleteDashboard: vi.fn(),
    shareDefault: vi.fn(),
    requestThreadDump: vi.fn(),
    getScatter: vi.fn(),
  },
}))
vi.mock('@/api/systems', () => ({ systemsApi: { getSystems: vi.fn() } }))
vi.mock('@/api/agents', () => ({ agentsApi: { getAgents: vi.fn() } }))
vi.mock('@/api/aggregations', () => ({ aggregationsApi: { getMetricsLiveSummary: vi.fn() } }))

import { apmApi } from '@/api/apm'
import { agentsApi } from '@/api/agents'
import { aggregationsApi } from '@/api/aggregations'
import { systemsApi } from '@/api/systems'
import {
  AGENTS,
  aggOf,
  dashboard,
  emptyLive,
  installLiveTestHooks,
  renderPage,
  toast,
  useApmLiveStream,
  widget,
} from './liveTestKit'

installLiveTestHooks()

describe('위젯 상호작용', () => {
  const now = Date.now()
  const top = (uri: string, ms: number, id: string) => ({
    trace_id: id.padEnd(32, '0'),
    span_id: id.padEnd(16, '0'),
    thread: 'T-1',
    uri,
    start_ts: now,
    elapsed_ms: ms,
    phase: 'sql',
    sql: 'select 1',
    stack: ['at Foo.bar', 'at Baz.qux'],
  })
  const live = () =>
    emptyLive({
      active: new Map([
        [
          '3:was1',
          {
            system_id: 3,
            instance_role: 'was1',
            ts: now,
            slow_ms: 3000,
            buckets: [2, 1, 1],
            top: [top('/slow', 9500, 'aa'), top('/mid', 4000, 'bb')],
          },
        ],
        [
          '3:was2',
          {
            system_id: 3,
            instance_role: 'was2',
            ts: now,
            slow_ms: 3000,
            buckets: [1, 0, 0],
            top: [top('/other', 100, 'cc')],
          },
        ],
      ]),
      points: [
        {
          system_id: 3,
          instance_role: 'was1',
          points: [
            {
              ts: now - 1000,
              elapsed_ms: 500,
              error: false,
              trace_id: 't'.repeat(32),
              span_id: 's'.repeat(16),
            },
            {
              ts: now - 2000,
              elapsed_ms: 9000,
              error: true,
              trace_id: 'u'.repeat(32),
              span_id: 'v'.repeat(16),
            },
          ],
        },
      ],
      agg: new Map([
        [
          '3:was1',
          [
            {
              system_id: 3,
              instance_role: 'was1',
              ts: 5000,
              tps: 10,
              avg_ms: 120,
              err_rate: 0.01,
              slow_cnt: 1,
              uri_top: [{ uri: '/a', cnt: 3, ms: 300 }],
              sql_top: [{ sql: 'select x', cnt: 2, ms: 50 }],
              jvm: {
                threads: 40,
                cpu_ratio: 0.3,
                heap_used: 1048576 * 100,
                gc_ms: 10,
                conn_active: 4,
                conn_max: 20,
              },
              dropped: { detail: 0, sql: 0, tx: 0 },
            },
            {
              system_id: 3,
              instance_role: 'was1',
              ts: 10000,
              tps: 12,
              avg_ms: 130,
              err_rate: 0.02,
              slow_cnt: 1,
              uri_top: [],
              sql_top: [],
              jvm: { threads: 42, cpu_ratio: 0.4, heap_used: 1048576 * 110, gc_ms: 25 },
              dropped: { detail: 0, sql: 0, tx: 0 },
            },
          ],
        ],
      ]),
    })

  const allTypes: WidgetType[] = [
    'queue',
    'scatter',
    'active_list',
    'tps',
    'avg_ms',
    'err_rate',
    'uri_top',
    'sql_top',
    'jvm_users_threads',
    'jvm_cpu',
    'jvm_heap_gc',
    'jvm_conn_pool',
  ]

  it('12종 위젯이 데이터와 함께 오류 없이 렌더링된다', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard(allTypes.map((t, n) => widget(`w-${t}`, t, n * 5))),
    ])
    renderPage()
    expect(await screen.findByText('액티브 큐')).toBeInTheDocument()
    for (const t of [
      '트랜잭션 모니터링',
      '진행 중 트랜잭션',
      'URL 상위',
      'SQL 상위',
      'DB 커넥션 풀',
    ]) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    expect(screen.getByText('select x')).toBeInTheDocument()
    expect(screen.getByText('/a')).toBeInTheDocument()
  })

  it('액티브 큐: 아직 이벤트가 없는 인스턴스도 0건 막대로 그린다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard([widget('q', 'queue')])])
    renderPage()
    const canvas = await screen.findByLabelText(/^액티브 트랜잭션 큐/)
    await waitFor(() => expect(canvas).toHaveAccessibleName(/api1 0건/))
    expect(canvas).toHaveAccessibleName(/was1 0건.*was2 0건/)
    expect(screen.queryByText('수신 대기')).not.toBeInTheDocument()
  })

  it('동시 사용자·JVM 스레드: 두 값을 선과 라벨로 보이고 설명 힌트를 둔다', async () => {
    const mk = (role: string, threads: number, users: number) => [
      { ...aggOf(3, role, 1, 5000), jvm: { threads }, users_5m: users },
      { ...aggOf(3, role, 1, 10000), jvm: { threads }, users_5m: users },
    ]
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('u', 'jvm_users_threads')]),
    ])
    useApmLiveStream.mockReturnValue(emptyLive({ agg: new Map([['3:was1', mk('was1', 208, 35)]]) }))
    const { unmount } = renderPage('/apm/live?system=3')
    const legend = await screen.findByTestId('chart-legend')
    expect(legend).toHaveTextContent('동시 사용자 (5분 고유) 35')
    expect(legend).toHaveTextContent('JVM 스레드 208')
    expect(screen.getByTestId('users-threads-hint')).toHaveAccessibleName(/JVM 전체/)
    unmount()

    useApmLiveStream.mockReturnValue(
      emptyLive({
        agg: new Map([
          ['3:was1', mk('was1', 208, 35)],
          ['3:was2', mk('was2', 50, 5)],
        ]),
      }),
    )
    renderPage('/apm/live?system=3')
    const legend2 = await screen.findByTestId('chart-legend')
    expect(legend2).toHaveTextContent('동시 사용자 (5분 고유) 합계 40')
    expect(legend2).toHaveTextContent('JVM 스레드 합계 258')
  })

  it('동시 사용자: 구 gateway(users_5m 없음)면 스레드 선만 보인다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('u', 'jvm_users_threads')]),
    ])
    useApmLiveStream.mockReturnValue(
      emptyLive({
        agg: new Map([['3:was1', [{ ...aggOf(3, 'was1', 1, 5000), jvm: { threads: 9 } }]]]),
      }),
    )
    renderPage('/apm/live?system=3')
    const legend = await screen.findByTestId('chart-legend')
    expect(legend).toHaveTextContent('JVM 스레드 9')
    expect(legend).not.toHaveTextContent('동시 사용자')
  })

  it('미니 차트: 최대값 축 라벨과 KST 시작/끝 시각을 보인다', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard([widget('c', 'jvm_cpu')])])
    renderPage()
    const axis = await screen.findByTestId('chart-time-axis')
    // ts 5000 / 10000 (UTC epoch ms) = 1970-01-01 09:00:05 / 09:00:10 KST
    expect(axis).toHaveTextContent('09:00:05')
    expect(axis).toHaveTextContent('09:00:10')
    expect(screen.getByTestId('chart-ymax')).toHaveTextContent('40.0%')
  })

  it('큐 막대 클릭 → 진행 중 목록이 해당 인스턴스로 필터된다', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('q', 'queue'), widget('l', 'active_list', 6)]),
    ])
    renderPage()
    await screen.findByText('/slow')
    expect(screen.getByText('/other')).toBeInTheDocument()
    // 캔버스 폭 300(기본) · 막대 2개 → x=10 은 첫 번째(was1)
    fireEvent.click(screen.getByLabelText(/^액티브 트랜잭션 큐/), { clientX: 10, clientY: 10 })
    await waitFor(() => expect(screen.queryByText('/other')).not.toBeInTheDocument())
    expect(screen.getByText(/필터: .*was1/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('필터 해제'))
    expect(await screen.findByText('/other')).toBeInTheDocument()
  })

  it('진행 중 행 클릭 → 스택 표시, 스레드 덤프 요청 성공/409', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard([widget('l', 'active_list')])])
    vi.mocked(agentsApi.getAgents).mockResolvedValue([
      { id: 77, label_info: '{"instance_role":"was1"}' },
    ] as never)
    renderPage()
    await userEvent.click(await screen.findByText('/slow'))
    const stackPre = screen.getByText(/at Foo\.bar/)
    expect(stackPre.tagName).toBe('PRE')
    expect(stackPre.textContent).toBe('at Foo.bar\nat Baz.qux')

    vi.mocked(apmApi.requestThreadDump).mockResolvedValueOnce({ command_id: 1 })
    await userEvent.click(screen.getByRole('button', { name: '스레드 덤프' }))
    await waitFor(() => expect(apmApi.requestThreadDump).toHaveBeenCalledWith(77))
    expect(toast.success).toHaveBeenCalled()

    vi.mocked(apmApi.requestThreadDump).mockRejectedValueOnce(
      new HTTPError(new Response(null, { status: 409 }), new Request('http://x'), {} as never),
    )
    await userEvent.click(screen.getByRole('button', { name: '스레드 덤프' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('진행 중')))

    vi.mocked(apmApi.requestThreadDump).mockRejectedValueOnce(new Error('boom'))
    await userEvent.click(screen.getByRole('button', { name: '스레드 덤프' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())

    vi.mocked(agentsApi.getAgents).mockResolvedValueOnce([])
    await userEvent.click(screen.getByRole('button', { name: '스레드 덤프' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
  })

  it('산점도 드래그 선택 → 트랜잭션 분석 페이지로 이동', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard([widget('s', 'scatter')])])
    renderPage()
    const canvas = await screen.findByLabelText('트랜잭션 모니터링')
    fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(canvas)
    expect(await screen.findByText('트랜잭션 분석 이동됨')).toBeInTheDocument()
  })

  it('산점도 시간축을 과거로 옮기면 getScatter 를 조회한다', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard([widget('s', 'scatter')])])
    vi.mocked(apmApi.getScatter).mockResolvedValue({
      points: [
        {
          ts: '2026-10-30T00:00:00',
          elapsed_ms: 100,
          error: false,
          trace_id: 'a',
          span_id: 'b',
          system_id: 3,
        },
      ],
      truncated: true,
    })
    renderPage('/apm/live?system=3')
    await userEvent.selectOptions(await screen.findByLabelText('산점도 시간 범위'), '60')
    await waitFor(() => expect(apmApi.getScatter).toHaveBeenCalled())
    expect(vi.mocked(apmApi.getScatter).mock.calls[0][0].system_ids).toEqual([3])
    expect(await screen.findByText('일부만 표시')).toBeInTheDocument()
  })
})

describe('실시간 모니터링 보강', () => {
  it('편집 모드에서 삭제 버튼은 제목 앞(왼쪽)에 있고 그리드 아래에 AI 버튼 여백이 생긴다', async () => {
    const { container } = renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '편집' }))
    const del = screen.getByRole('button', { name: 'TPS 삭제' })
    const header = del.parentElement as HTMLElement
    expect(header.firstElementChild).toBe(del)
    expect(container.querySelector('.pb-28')).not.toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '편집 완료' }))
    expect(container.querySelector('.pb-28')).toBeNull()
  })

  it('Agent-T 가 없는 시스템을 고르면 안내와 에이전트 관리 링크를 보이고 트리는 계속 쓸 수 있다', async () => {
    vi.mocked(systemsApi.getSystems).mockResolvedValue([
      { id: 3, display_name: '시스템3', system_name: 's3' },
      { id: 4, display_name: '시스템4', system_name: 's4' },
      { id: 7, display_name: '빈시스템', system_name: 's7' },
    ] as never)
    renderPage('/apm/live?system=7')
    expect(await screen.findByText(/이 시스템에 등록된 Agent-T 가 없습니다/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '에이전트 관리' })[0]).toHaveAttribute(
      'href',
      '/agents',
    )
    const tree = screen.getByRole('complementary', { name: '호스트 목록' })
    await userEvent.click(await within(tree).findByRole('button', { name: /was1/ }))
    expect(screen.queryByText(/이 시스템에 등록된 Agent-T 가 없습니다/)).not.toBeInTheDocument()
  })

  it('?system= 이 모르는 id 면 전체로 되돌린다', async () => {
    renderPage('/apm/live?system=999')
    const tree = screen.getByRole('complementary', { name: '호스트 목록' })
    await within(tree).findByRole('button', { name: /was1/ })
    expect(within(tree).getByRole('button', { name: /^전체 \(OVERALL\)/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.queryByText(/이 시스템에 등록된 Agent-T 가 없습니다/)).not.toBeInTheDocument()
  })

  it('에이전트 조회 중에는 0 대신 스켈레톤을 보이고 실패하면 다시 시도할 수 있다', async () => {
    let resolve!: (v: never) => void
    vi.mocked(agentsApi.getAgents).mockReturnValueOnce(new Promise((r) => (resolve = r)))
    renderPage()
    const tree = screen.getByRole('complementary', { name: '호스트 목록' })
    expect(
      within(tree).getByRole('status', { name: '호스트 목록 불러오는 중' }),
    ).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /^전체 \(OVERALL\)\s*-$/ })).toBeInTheDocument()
    resolve(AGENTS as never)
    await within(tree).findByRole('button', { name: /was1/ })
    expect(within(tree).queryByRole('status')).not.toBeInTheDocument()
  })

  it('에이전트 조회가 실패하면 오류 안내와 다시 시도 버튼을 보인다', async () => {
    vi.mocked(agentsApi.getAgents).mockRejectedValueOnce(new Error('boom'))
    renderPage()
    const tree = screen.getByRole('complementary', { name: '호스트 목록' })
    await userEvent.click(await within(tree).findByRole('button', { name: '다시 시도' }))
    expect(await within(tree).findByRole('button', { name: /was1/ })).toBeInTheDocument()
  })

  it('시스템 행에 호스트 메모리(MEM)를 함께 보여 준다', async () => {
    vi.mocked(aggregationsApi.getMetricsLiveSummary).mockImplementation(async (id) =>
      id === 3 ? { memory: 62.4 } : {},
    )
    renderPage()
    const tree = screen.getByRole('complementary', { name: '호스트 목록' })
    expect(await within(tree).findByText(/MEM 62%/)).toBeInTheDocument()
    expect(within(tree).getAllByText(/MEM/)).toHaveLength(1)
    expect(aggregationsApi.getMetricsLiveSummary).toHaveBeenCalledWith(3, 'synapse_agent')
  })
})
