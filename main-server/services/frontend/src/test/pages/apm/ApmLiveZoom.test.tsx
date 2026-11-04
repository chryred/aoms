import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

import { apmApi } from '@/api/apm'
import {
  dashboard,
  emptyLive,
  installLiveTestHooks,
  renderPage,
  useApmLiveStream,
  widget,
} from './liveTestKit'
import { TabActiveContext } from '@/components/layout/tabs/TabContext'
import { WidgetZoom } from '@/components/apm/live/WidgetZoom'

installLiveTestHooks()

const NOW = Date.now()
const live = () =>
  emptyLive({
    points: [
      {
        system_id: 3,
        instance_role: 'was1',
        points: [
          { ts: NOW - 1000, elapsed_ms: 100, error: false, trace_id: 't1', span_id: 's1' },
          { ts: NOW - 2000, elapsed_ms: 200, error: false, trace_id: 't2', span_id: 's2' },
        ],
      },
    ],
  } as never)

describe('위젯 확대 오버레이', () => {
  beforeEach(() => {
    vi.mocked(apmApi.listDashboards).mockResolvedValue([dashboard([widget('sc', 'scatter')])])
    useApmLiveStream.mockReturnValue(live())
  })

  it('산점도 드래그 선택으로 트랜잭션 탭으로 이동하면 확대 오버레이가 닫힌다', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '트랜잭션 모니터링 확대' }))
    const dialog = screen.getByRole('dialog')
    const canvas = within(dialog).getByRole('img', { name: '트랜잭션 모니터링' })
    fireEvent.mouseDown(canvas, { clientX: 60, clientY: 20 })
    fireEvent.mouseMove(canvas, { clientX: 200, clientY: 100 })
    fireEvent.mouseUp(canvas)
    expect(await screen.findByText('트랜잭션 분석 이동됨')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('확대 산점도는 카드와 같은 점 개수를 즉시 보이고 시간 범위가 양방향 동기화된다', async () => {
    renderPage()
    const cardCount = (await screen.findAllByText(/건$/))[0].textContent
    await userEvent.click(screen.getByRole('button', { name: '트랜잭션 모니터링 확대' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/건$/).textContent).toBe(cardCount)
    expect(cardCount).toBe('2건')
    // 카드에서 범위 변경 -> 확대에 반영
    const [cardSel, zoomSel] = screen.getAllByLabelText('산점도 시간 범위') as HTMLSelectElement[]
    await userEvent.selectOptions(cardSel, '60')
    expect(zoomSel.value).toBe('60')
    // 확대에서 변경 -> 카드에 반영
    await userEvent.selectOptions(zoomSel, '180')
    expect(cardSel.value).toBe('180')
  })
})

describe('WidgetZoom 탭 비활성', () => {
  it('비활성 탭에서는 렌더하지 않고 onClose 를 호출한다', () => {
    const onClose = vi.fn()
    const ui = (active: boolean) => (
      <TabActiveContext.Provider value={active}>
        <WidgetZoom title="TPS" scopeLabel="전체" returnFocusTo={null} onClose={onClose}>
          <div>내용</div>
        </WidgetZoom>
      </TabActiveContext.Provider>
    )
    const { rerender } = render(ui(true))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    rerender(ui(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
