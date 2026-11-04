import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
import { DEFAULT_LAYOUT, LAYOUT_VERSION } from '@/components/apm/live/defaultLayout'
import { widgetRegistry } from '@/components/apm/live/widgetRegistry'
import {
  aggOf,
  dashboard,
  emptyLive,
  installLiveTestHooks,
  renderPage,
  useApmLiveStream,
  widget,
} from './liveTestKit'

installLiveTestHooks()

// 800ms 디바운스 자동 저장은 실시간 대기 대신 가짜 시계를 직접 흘려 검증한다.
// shouldAdvanceTime: userEvent/RTL 내부 setTimeout 이 멈추지 않도록 시계가 실제 시간과 함께 흐른다.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
})
const flush = (ms = 1000) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('기본 화면과 자동 저장', () => {
  it('저장된 화면이 없어도 기본 배치 11종이 바로 보인다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([])
    renderPage()
    for (const t of [
      '액티브 큐',
      'JVM CPU',
      '동시 사용자·스레드',
      'TPS',
      '평균 응답시간',
      '에러율',
      '힙·GC',
      '트랜잭션 모니터링',
      '진행 중 트랜잭션',
      'URL 상위',
      'SQL 상위',
    ]) {
      expect((await screen.findAllByText(t)).length).toBeGreaterThan(0)
    }
    expect(DEFAULT_LAYOUT).toHaveLength(12)
    expect(new Set(DEFAULT_LAYOUT.map((w) => w.type)).size).toBe(12)
    expect(DEFAULT_LAYOUT.some((w) => w.type === 'jvm_conn_pool')).toBe(true)
    expect(widgetRegistry.jvm_conn_pool).toBeDefined()
    expect(screen.queryByRole('button', { name: /^저장/ })).not.toBeInTheDocument()
    expect(screen.queryByText('저장 안 됨')).not.toBeInTheDocument()
    expect(apmApi.createDashboard).not.toHaveBeenCalled()
  })

  it('사용자 본인의 저장본이 있으면 그것을 쓴다', async () => {
    renderPage()
    await screen.findByText('평균 응답시간')
    expect(screen.queryByText('액티브 큐')).not.toBeInTheDocument()
  })

  it('편집에서 위젯을 추가하면 800ms 후 create, 이어서 update 로 자동 저장된다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([])
    renderPage()
    await screen.findByText('액티브 큐')
    await userEvent.click(screen.getByRole('button', { name: '편집' }))
    await userEvent.click(screen.getByRole('button', { name: 'TPS 추가' }))
    await flush()
    await waitFor(() => expect(apmApi.createDashboard).toHaveBeenCalledTimes(1))
    const body = vi.mocked(apmApi.createDashboard).mock.calls[0][0]
    expect(body.name).toBe('기본 화면')
    expect(body.layout).toHaveLength(13)

    await userEvent.click(screen.getByRole('button', { name: '에러율 삭제' }))
    await flush()
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalledTimes(1))
    const [id, upd] = vi.mocked(apmApi.updateDashboard).mock.calls[0]
    expect(id).toBe(9)
    expect(upd.layout).toHaveLength(12)
    expect(upd.layout.some((w) => w.type === 'err_rate')).toBe(false)
    expect(apmApi.createDashboard).toHaveBeenCalledTimes(1)
  })

  it('기존 저장본은 update 로 저장하며 연속 변경은 한 번으로 합친다', async () => {
    renderPage()
    await screen.findByText('평균 응답시간')
    await userEvent.click(screen.getByRole('button', { name: '편집' }))
    await userEvent.click(screen.getByRole('button', { name: 'TPS 삭제' }))
    await userEvent.click(screen.getByRole('button', { name: '평균 응답시간 삭제' }))
    await flush()
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalled())
    expect(apmApi.updateDashboard).toHaveBeenCalledTimes(1)
    const [id, body] = vi.mocked(apmApi.updateDashboard).mock.calls[0]
    expect(id).toBe(1)
    expect(body.name).toBe('내 화면')
    expect(body.layout).toEqual([])
  })

  it('버전 없는 구 저장본은 기본 배치로 바뀌고 한 번만 자동 저장된다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('a', 'tps'), widget('b', 'avg_ms', 5)], { filters: {} }),
    ])
    renderPage()
    await screen.findByText('액티브 큐')
    await flush()
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalledTimes(1))
    const [id, body] = vi.mocked(apmApi.updateDashboard).mock.calls[0]
    expect(id).toBe(1)
    expect(body.layout).toHaveLength(DEFAULT_LAYOUT.length)
    expect(body.filters).toEqual({ layout_version: LAYOUT_VERSION })
    await flush(1200)
    expect(apmApi.updateDashboard).toHaveBeenCalledTimes(1)
  })

  it('v3 이하 저장본은 v4 기본 배치로 한 번 바뀌고 저장된다', async () => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([
      dashboard([widget('a', 'tps')], { filters: { layout_version: 3 } }),
    ])
    renderPage()
    await screen.findByText('액티브 큐')
    await flush()
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalledTimes(1))
    const body = vi.mocked(apmApi.updateDashboard).mock.calls[0][1]
    expect(body.layout.map((w) => w.type)).toEqual(DEFAULT_LAYOUT.map((w) => w.type))
    expect(body.filters).toEqual({ layout_version: 4 })
  })

  it('화면 잠금 토글: 기본은 이동 가능(헤더 핸들), 잠그면 핸들·포커스가 사라진다', async () => {
    renderPage()
    await screen.findByText('평균 응답시간')
    expect(document.querySelectorAll('.widget-drag-handle[tabindex="0"]').length).toBeGreaterThan(0)
    const lock = screen.getByRole('button', { name: '화면 잠금' })
    expect(lock).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(lock)
    expect(lock).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: /^TPS \(Enter로 확대\)$/ })).toBeInTheDocument()
    expect(document.querySelector('[data-locked="true"]')).not.toBeNull()
  })

  it('확대: 버튼·더블클릭·Enter 로 열고 Esc/×/배경/더블클릭으로 닫으며 포커스가 헤더로 돌아온다', async () => {
    renderPage()
    await screen.findByText('평균 응답시간')
    const header = () => screen.getByRole('group', { name: /^TPS 위치/ })
    // 버튼으로 열기
    await userEvent.click(screen.getByRole('button', { name: 'TPS 확대' }))
    const dialog = screen.getByRole('dialog', { name: 'TPS 확대' })
    expect(dialog).toHaveFocus()
    expect(dialog).toHaveTextContent('전체') // 현재 범위
    // Esc 로 닫고 헤더로 포커스 복귀
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(header()).toHaveFocus()
    // 헤더 Enter
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // × 로 닫기
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(header()).toHaveFocus()
    // 헤더 더블클릭으로 열기, 배경 클릭으로 닫기
    await userEvent.dblClick(screen.getByText('TPS', { selector: 'span.truncate' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('widget-zoom-backdrop'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // 열린 오버레이 안 더블클릭으로 닫기
    await userEvent.click(screen.getByRole('button', { name: 'TPS 확대' }))
    await userEvent.dblClick(screen.getByRole('heading', { name: 'TPS' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // 저장 레이아웃은 건드리지 않는다
    await flush(1000)
    expect(apmApi.updateDashboard).not.toHaveBeenCalled()
    expect(apmApi.createDashboard).not.toHaveBeenCalled()
  })

  it('최신 버전 저장본(사용자 편집)은 그대로 유지하고 재저장하지 않는다', async () => {
    renderPage()
    await screen.findByText('평균 응답시간')
    expect(screen.queryByText('액티브 큐')).not.toBeInTheDocument()
    await flush(1200)
    expect(apmApi.updateDashboard).not.toHaveBeenCalled()
    expect(apmApi.createDashboard).not.toHaveBeenCalled()
  })

  it('위젯이 30개이면 추가 버튼이 비활성화된다', async () => {
    const layout = Array.from({ length: 30 }, (_, n) => widget(`w${n}`, 'tps', n * 5))
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard(layout)])
    renderPage()
    await screen.findAllByText('TPS')
    await userEvent.click(screen.getByRole('button', { name: '편집' }))
    for (const b of screen.getAllByRole('button', { name: /추가$/ })) expect(b).toBeDisabled()
  })

  it('"기본 화면으로" 는 인라인 확인 후 기본 배치를 자동 저장한다', async () => {
    renderPage()
    await screen.findByText('평균 응답시간')
    await userEvent.click(screen.getByRole('button', { name: '기본 화면으로' }))
    await userEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByText('액티브 큐')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '기본 화면으로' }))
    await userEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    expect(await screen.findByText('액티브 큐')).toBeInTheDocument()
    await flush()
    await waitFor(() => expect(apmApi.updateDashboard).toHaveBeenCalledTimes(1))
    expect(vi.mocked(apmApi.updateDashboard).mock.calls[0][1].layout).toHaveLength(12)
  })

  it('fallback 배지와 수집 누락 배지를 표시한다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        status: 'fallback',
        agg: new Map([
          ['3:was1', [{ ...aggOf(3, 'was1', 1), dropped: { detail: 0, sql: 2, tx: 0 } }]],
        ]),
      }),
    )
    renderPage()
    expect(await screen.findByText(/폴링 중/)).toBeInTheDocument()
    expect(await screen.findByText(/수집 누락 시스템3\/was1/)).toBeInTheDocument()
  })

  it('항상 전체 시스템을 구독한다 (범위 전환에 재연결하지 않음)', async () => {
    renderPage('/apm/live?system=3')
    await waitFor(() => expect(useApmLiveStream).toHaveBeenLastCalledWith([3, 4], true))
  })
})
