import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HTTPError } from 'ky'

const { useApmLiveStream, toast } = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
  return { useApmLiveStream: vi.fn(), toast }
})
vi.mock('@/hooks/useApmLiveStream', () => ({ useApmLiveStream }))
vi.mock('react-hot-toast', () => ({ default: toast }))
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

import { apmApi } from '@/api/apm'
import { agentsApi } from '@/api/agents'
import { systemsApi } from '@/api/systems'
import { useAuthStore } from '@/store/authStore'
import { ApmLivePage } from '@/pages/apm/ApmLivePage'
import type { ApmDashboard, DashboardWidget, WidgetType } from '@/types/apm'
import type { LiveData } from '@/hooks/useApmLiveStream'
import type { User } from '@/types/auth'

const widget = (i: string, type: WidgetType, y = 0): DashboardWidget => ({
  i,
  type,
  x: 0,
  y,
  w: 4,
  h: 5,
})
const dashboard = (layout: DashboardWidget[], over: Partial<ApmDashboard> = {}): ApmDashboard => ({
  id: 1,
  name: '내 화면',
  layout,
  filters: {},
  is_shared_default: false,
  owner_user_id: 10,
  updated_at: '2026-10-30T00:00:00',
  ...over,
})

const emptyLive = (over: Partial<LiveData> = {}): LiveData => ({
  active: new Map(),
  points: [],
  agg: new Map(),
  status: 'open',
  ...over,
})

function fakeCtx() {
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : () => {}),
      set: () => true,
    },
  )
}

function renderPage(url = '/apm/live') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/apm/live" element={<ApmLivePage />} />
          <Route path="/apm/tx/:t/:s" element={<div>상세 이동됨</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // jsdom 에는 ResizeObserver 가 없다 (react-grid-layout WidthProvider 가 사용)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeCtx() as unknown as CanvasRenderingContext2D,
  )
  useApmLiveStream.mockReturnValue(emptyLive())
  useAuthStore.setState({ user: { id: 10, role: 'operator' } as User, token: 't' })
  vi.mocked(systemsApi.getSystems).mockResolvedValue([
    { id: 3, display_name: '시스템3', system_name: 's3' },
    { id: 4, display_name: '시스템4', system_name: 's4' },
  ] as never)
  vi.mocked(apmApi.listDashboards).mockResolvedValue([
    dashboard([widget('a', 'tps'), widget('b', 'avg_ms', 5)]),
  ])
  vi.mocked(apmApi.updateDashboard).mockResolvedValue(dashboard([]))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('ApmLivePage', () => {
  it('?system=3 진입 시 스트림 훅에 [3] 을 넘긴다', async () => {
    renderPage('/apm/live?system=3')
    await screen.findByText('TPS')
    expect(useApmLiveStream).toHaveBeenCalledWith([3])
  })

  it('쿼리스트링이 없고 선택이 비어 있으면 전체 시스템 id 로 구독한다', async () => {
    renderPage()
    await waitFor(() => expect(useApmLiveStream).toHaveBeenLastCalledWith([3, 4]))
  })

  it('저장 클릭 시 updateDashboard 에 layout 이 전달된다', async () => {
    renderPage()
    await screen.findByText('TPS')
    await userEvent.click(screen.getByRole('button', { name: /저장/ }))
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalledTimes(1))
    const [id, body] = vi.mocked(apmApi.updateDashboard).mock.calls[0]
    expect(id).toBe(1)
    expect(body.layout).toHaveLength(2)
    expect(body.name).toBe('내 화면')
  })

  it('편집 모드에서 위젯 추가 시 "저장 안 됨" 이 뜨고, 30개가 되면 추가 버튼이 비활성화된다', async () => {
    const layout = Array.from({ length: 29 }, (_, n) => widget(`w${n}`, 'tps', n * 5))
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard(layout)])
    renderPage()
    await screen.findAllByText('TPS')
    expect(screen.queryByText('저장 안 됨')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'TPS 추가' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /편집/ }))
    const add = screen.getByRole('button', { name: 'TPS 추가' })
    expect(add).toBeEnabled()
    await userEvent.click(add) // 30번째
    expect(screen.getByText('저장 안 됨')).toBeInTheDocument()
    expect(screen.getByText(/30\/30/)).toBeInTheDocument()
    for (const b of screen.getAllByRole('button', { name: /추가$/ })) expect(b).toBeDisabled()
  })

  it('편집 모드에서 위젯 삭제와 이름 변경이 저장 본문에 반영된다', async () => {
    renderPage()
    await screen.findByText('TPS')
    await userEvent.click(screen.getByRole('button', { name: /편집/ }))
    await userEvent.click(screen.getByRole('button', { name: 'TPS 삭제' }))
    const name = screen.getByLabelText('이름 변경')
    await userEvent.clear(name)
    await userEvent.type(name, '새이름')
    await userEvent.click(screen.getByRole('button', { name: /저장/ }))
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalled())
    const body = vi.mocked(apmApi.updateDashboard).mock.calls[0][1]
    expect(body.layout.map((w) => w.i)).toEqual(['b'])
    expect(body.name).toBe('새이름')
  })

  it('새 화면 저장은 createDashboard 를 호출한다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([])
    vi.mocked(apmApi.createDashboard).mockResolvedValue(dashboard([], { id: 9, name: '새 화면' }))
    renderPage()
    await screen.findByText(/표시할 위젯이 없습니다/)
    await userEvent.click(screen.getByRole('button', { name: /저장/ }))
    await waitFor(() => expect(apmApi.createDashboard).toHaveBeenCalledTimes(1))
    expect(vi.mocked(apmApi.createDashboard).mock.calls[0][0]).toMatchObject({
      name: '새 화면',
      layout: [],
    })
  })

  it('화면 전환·새 화면·삭제', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('a', 'tps')]),
      dashboard([widget('c', 'sql_top')], { id: 2, name: '두번째' }),
    ])
    vi.mocked(apmApi.deleteDashboard).mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()
    await screen.findByText('TPS')
    await userEvent.selectOptions(screen.getByLabelText('화면'), '2')
    expect(await screen.findByText('SQL 상위')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /새 화면/ }))
    expect(screen.getByText(/표시할 위젯이 없습니다/)).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('화면'), '1')
    await userEvent.click(screen.getByRole('button', { name: /삭제$/ }))
    await waitFor(() => expect(apmApi.deleteDashboard).toHaveBeenCalledWith(1))
  })

  it('공유 기본 지정 버튼은 admin 에게만 보인다', async () => {
    renderPage()
    await screen.findByText('TPS')
    expect(screen.queryByRole('button', { name: /공유 기본으로 지정/ })).not.toBeInTheDocument()
  })

  it('admin 은 공유 기본으로 지정할 수 있다', async () => {
    useAuthStore.setState({ user: { id: 10, role: 'admin' } as User, token: 't' })
    vi.mocked(apmApi.shareDefault).mockResolvedValue(dashboard([]))
    renderPage()
    await screen.findByText('TPS')
    await userEvent.click(screen.getByRole('button', { name: /공유 기본으로 지정/ }))
    await waitFor(() => expect(apmApi.shareDefault).toHaveBeenCalledWith(1))
  })

  it('fallback 배지와 수집 누락 배지를 표시한다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        status: 'fallback',
        agg: new Map([
          [
            '3:was1',
            [
              {
                system_id: 3,
                instance_role: 'was1',
                ts: 1,
                tps: 1,
                avg_ms: 1,
                err_rate: 0,
                slow_cnt: 0,
                uri_top: [],
                sql_top: [],
                jvm: null,
                dropped: { detail: 0, sql: 2, tx: 0 },
              },
            ],
          ],
        ]),
      }),
    )
    renderPage()
    expect(await screen.findByText(/폴링 중/)).toBeInTheDocument()
    expect(await screen.findByText(/수집 누락 시스템3\/was1/)).toBeInTheDocument()
  })
})

describe('위젯별 대상 · 저장 안 됨 기준선', () => {
  const aggFor = (system_id: number) => ({
    system_id,
    instance_role: 'was1',
    ts: 5000,
    tps: 12,
    avg_ms: 1,
    err_rate: 0,
    slow_cnt: 0,
    uri_top: [],
    sql_top: [],
    jvm: null,
    dropped: { detail: 0, sql: 0, tx: 0 },
  })

  it('?system= 으로 진입해도 사용자가 바꾸기 전에는 "저장 안 됨" 이 없다', async () => {
    renderPage('/apm/live?system=3')
    await screen.findByText('TPS')
    expect(screen.queryByText('저장 안 됨')).not.toBeInTheDocument()
  })

  it('편집 모드에서 위젯 대상을 지정하면 저장 본문 layout 에 target 이 들어간다', async () => {
    renderPage()
    await screen.findByText('TPS')
    await userEvent.click(screen.getByRole('button', { name: /편집/ }))
    await userEvent.click(screen.getByRole('button', { name: 'TPS 대상' }))
    await userEvent.click(screen.getAllByText('시스템 선택...').pop()!)
    await userEvent.click(screen.getByRole('button', { name: /시스템4/ }))
    expect(screen.getByText('저장 안 됨')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^저장/ }))
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalled())
    const layout = vi.mocked(apmApi.updateDashboard).mock.calls[0][1].layout
    expect(layout.find((w) => w.i === 'a')?.target).toEqual({ system_ids: [4] })
    expect(layout.find((w) => w.i === 'b')?.target).toBeUndefined()
  })

  it('"상단 필터 따름" 은 target 을 제거한다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([{ ...widget('a', 'tps'), target: { system_ids: [4], instance_role: 'was1' } }]),
    ])
    renderPage()
    await screen.findByText('TPS')
    await userEvent.click(screen.getByRole('button', { name: /편집/ }))
    await userEvent.click(screen.getByRole('button', { name: 'TPS 대상' }))
    await userEvent.click(screen.getAllByRole('button', { name: '상단 필터 따름' }).pop()!)
    await userEvent.click(screen.getByRole('button', { name: /^저장/ }))
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalled())
    expect(vi.mocked(apmApi.updateDashboard).mock.calls[0][1].layout[0]).not.toHaveProperty(
      'target',
    )
  })

  it('WAS 선택만으로도 target 이 지정된다', async () => {
    useApmLiveStream.mockReturnValue(emptyLive({ agg: new Map([['3:was1', [aggFor(3)]]]) }))
    renderPage()
    await screen.findAllByText('TPS')
    await userEvent.click(screen.getByRole('button', { name: /편집/ }))
    await userEvent.click(screen.getByRole('button', { name: 'TPS 대상' }))
    await userEvent.selectOptions(screen.getByLabelText('대상 WAS'), 'was1')
    await userEvent.click(screen.getByRole('button', { name: /^저장/ }))
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalled())
    expect(vi.mocked(apmApi.updateDashboard).mock.calls[0][1].layout[0].target).toEqual({
      instance_role: 'was1',
    })
  })

  it('위젯은 override 대상의 데이터로 렌더링된다 (상단 필터와 무관)', async () => {
    useApmLiveStream.mockReturnValue(emptyLive({ agg: new Map([['4:was1', [aggFor(4)]]]) }))
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([
        { ...widget('a', 'tps'), target: { system_ids: [4] } },
        { ...widget('b', 'avg_ms', 5), target: { system_ids: [3] } },
      ]),
    ])
    renderPage()
    expect(await screen.findByText('12.0')).toBeInTheDocument() // system 4 의 TPS
    expect(screen.getAllByText('데이터 수집 중')).toHaveLength(1) // system 3 대상 avg_ms 는 비어 있음
  })
})

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
    stack: 'at Foo.bar',
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
      '응답시간 산점도',
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

  it('큐 막대 클릭 → 진행 중 목록이 해당 인스턴스로 필터된다', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('q', 'queue'), widget('l', 'active_list', 6)]),
    ])
    renderPage()
    await screen.findByText('/slow')
    expect(screen.getByText('/other')).toBeInTheDocument()
    // 캔버스 폭 300(기본) · 막대 2개 → x=10 은 첫 번째(was1)
    fireEvent.click(screen.getByLabelText('액티브 트랜잭션 큐'), { clientX: 10, clientY: 10 })
    await waitFor(() => expect(screen.queryByText('/other')).not.toBeInTheDocument())
    expect(screen.getByText(/필터: 시스템3\/was1/)).toBeInTheDocument()
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
    expect(screen.getByText('at Foo.bar')).toBeInTheDocument()

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

  it('산점도 드래그 선택 → 목록 → 행 클릭 시 상세로 이동', async () => {
    useApmLiveStream.mockReturnValue(live())
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard([widget('s', 'scatter')])])
    renderPage()
    const canvas = await screen.findByLabelText('응답시간 산점도')
    fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(canvas)
    const list = await screen.findByLabelText('선택 영역 트랜잭션')
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(2)
    await userEvent.click(rows[0])
    expect(await screen.findByText('상세 이동됨')).toBeInTheDocument()
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
