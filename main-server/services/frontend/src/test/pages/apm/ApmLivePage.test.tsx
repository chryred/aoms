import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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

import { agentsApi } from '@/api/agents'
import { aggOf, emptyLive, installLiveTestHooks, renderPage, useApmLiveStream } from './liveTestKit'

installLiveTestHooks()

describe('호스트 목록', () => {
  it('에이전트 API 의 agent_t 인스턴스를 시스템 그룹 아래에 보여 준다', async () => {
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    expect(await within(tree).findByRole('button', { name: /was1/ })).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /was2.*WAS/ })).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /api1/ })).toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /^전체 \(OVERALL\)/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(tree).queryByText('rust')).not.toBeInTheDocument() // agent_t 가 아닌 에이전트
    expect(within(tree).getByRole('button', { name: /시스템3 접기/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('스트림에서만 보이는 인스턴스도 합쳐서 보여 주고 최근 수신 여부를 상태로 표시한다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        agg: new Map([
          ['3:was1', [aggOf(3, 'was1', 5)]],
          ['3:extra', [aggOf(3, 'extra', 1, 1000)]],
        ]),
      }),
    )
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const was1 = await within(tree).findByRole('button', { name: /was1/ })
    expect(within(was1).getByRole('img', { name: '수신 중' })).toBeInTheDocument()
    const extra = within(tree).getByRole('button', { name: /extra/ })
    expect(within(extra).getByRole('img', { name: '수신 없음' })).toBeInTheDocument()
  })

  it('시스템 그룹에 CPU / HEAP 평균을 보이고 값이 없으면 "-" 로 표시한다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        agg: new Map([
          [
            '3:was1',
            [{ ...aggOf(3, 'was1', 5), jvm: { cpu_ratio: 0.2, heap_used: 50, heap_max: 100 } }],
          ],
          [
            '3:was2',
            [{ ...aggOf(3, 'was2', 5), jvm: { cpu_ratio: 0.4, heap_used: 30, heap_max: 100 } }],
          ],
        ]),
      }),
    )
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const sys3 = await within(tree).findByRole('button', { name: /^시스템3\d/ })
    await waitFor(() => expect(sys3).toHaveTextContent('CPU 30% / HEAP 40%'))
    // 시스템4(api1)는 수신 데이터가 없다
    expect(within(tree).getByRole('button', { name: /^시스템4\d/ })).toHaveTextContent(
      'CPU - / HEAP -',
    )
  })

  it('CPU / HEAP / MEM 은 라벨+값을 한 덩어리(nowrap)로 묶어 중간에서 줄바꿈되지 않는다', async () => {
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const sys3 = await within(tree).findByRole('button', { name: /^시스템3\d/ })
    for (const label of ['CPU', 'HEAP']) {
      const group = Array.from(sys3.querySelectorAll('span.whitespace-nowrap')).find((n) =>
        n.textContent?.startsWith(label),
      )
      expect(group).toBeTruthy()
      expect(group?.textContent).toMatch(new RegExp(`^${label} \\S+$`))
    }
  })

  it('포함 체크박스는 accent 로 채워지지 않고 중립 테두리 + 체크 아이콘을 쓴다', async () => {
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const box = await within(tree).findByRole('checkbox', { name: 'was1 포함' })
    expect(box.className).not.toContain('accent-accent')
    expect(box.className).toContain('border-border-alt')
    expect(box.className).toContain('focus-visible:ring-accent')
    expect(box.parentElement?.querySelector('svg')).toBeTruthy()
  })

  it('인스턴스 행마다 WAS 유형 뱃지를 단다', async () => {
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    await within(tree).findByRole('button', { name: /was1/ })
    expect(within(tree).getAllByTestId('type-badge')).toHaveLength(3)
    expect(within(tree).getAllByText('WAS')).toHaveLength(3)
  })

  it('선택 항목은 채워진 강조색 면이 아니라 눌린 그림자 스타일이다', async () => {
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const all = within(tree).getByRole('button', { name: /^전체 \(OVERALL\)/ })
    expect(all).toHaveClass('shadow-neu-pressed')
    expect(all).not.toHaveClass('bg-accent')
  })

  it('그룹 접기 버튼이 인스턴스 행을 숨긴다', async () => {
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    await within(tree).findByRole('button', { name: /was1/ })
    await userEvent.click(within(tree).getByRole('button', { name: /시스템3 접기/ }))
    expect(within(tree).queryByRole('button', { name: /was1/ })).not.toBeInTheDocument()
    expect(within(tree).getByRole('button', { name: /api1/ })).toBeInTheDocument()
  })

  it('Agent-T 인스턴스가 없으면 에이전트 관리로 안내한다', async () => {
    vi.mocked(agentsApi.getAgents).mockResolvedValue([])
    renderPage()
    const link = await screen.findByRole('link', { name: '에이전트 관리' })
    expect(link).toHaveAttribute('href', '/agents')
    await screen.findByText('평균 응답시간')
  })

  it('?system=3 은 해당 시스템을 미리 선택한다', async () => {
    renderPage('/apm/live?system=3')
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const sys = await within(tree).findByRole('button', { name: /^시스템3\d/ })
    expect(sys).toHaveAttribute('aria-current', 'true')
    await screen.findByText('평균 응답시간')
  })

  it('범위를 고르면 요약과 위젯 대상이 그 범위로 바뀐다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        agg: new Map([
          ['3:was1', [aggOf(3, 'was1', 7)]],
          ['3:was2', [aggOf(3, 'was2', 5)]],
          ['4:api1', [aggOf(4, 'api1', 3)]],
        ]),
      }),
    )
    renderPage()
    const strip = await screen.findByLabelText('요약')
    await waitFor(() => expect(within(strip).getByText('15.0')).toBeInTheDocument())
    const tree = screen.getByRole('complementary', { name: '호스트 목록' })
    await userEvent.click(within(tree).getByRole('button', { name: /^시스템3\d/ }))
    expect(within(strip).getByText('12.0')).toBeInTheDocument()
    await userEvent.click(within(tree).getByRole('button', { name: /was2.*WAS/ }))
    expect(within(strip).getByText('응답/초 (TPS)').nextElementSibling).toHaveTextContent('5.0')
    expect(within(tree).getByRole('button', { name: /was2.*WAS/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('칩을 눌러 인스턴스를 숨기면 요약에서 빠지고, ALL 로 되돌린다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        agg: new Map([
          ['3:was1', [aggOf(3, 'was1', 7)]],
          ['3:was2', [aggOf(3, 'was2', 5)]],
        ]),
      }),
    )
    renderPage('/apm/live?system=3')
    const strip = await screen.findByLabelText('요약')
    const chips = screen.getByRole('group', { name: '인스턴스 선택' })
    await waitFor(() => expect(within(strip).getByText('12.0')).toBeInTheDocument())
    await userEvent.click(within(chips).getByRole('button', { name: 'was2' }))
    expect(within(chips).getByRole('button', { name: 'was2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(within(strip).getByText('7.0')).toBeInTheDocument()
    await userEvent.click(within(chips).getByRole('button', { name: 'ALL' }))
    expect(within(strip).getByText('12.0')).toBeInTheDocument()
  })

  it('요약 띠가 진행 건수와 정상/경고/심각 건수를 보여 준다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        active: new Map([
          [
            '3:was1',
            {
              system_id: 3,
              instance_role: 'was1',
              ts: Date.now(),
              slow_ms: 3000,
              buckets: [4, 2, 1],
              top: [],
            },
          ],
        ]),
      }),
    )
    renderPage()
    const strip = await screen.findByLabelText('요약')
    await waitFor(() => expect(within(strip).getByText('7')).toBeInTheDocument())
    expect(within(strip).getByText('4')).toBeInTheDocument()
    expect(within(strip).getByText('2')).toBeInTheDocument()
    expect(within(strip).getByText('1')).toBeInTheDocument()
  })

  it('요약 띠는 좌(진행) 중(정상·경고·심각, 시맨틱 색) 우(응답/초(TPS)·평균 응답·에러율) 로 배치된다', async () => {
    useApmLiveStream.mockReturnValue(
      emptyLive({
        active: new Map([
          [
            '3:was1',
            {
              system_id: 3,
              instance_role: 'was1',
              ts: Date.now(),
              slow_ms: 3000,
              buckets: [4, 2, 1],
              top: [],
            },
          ],
        ]),
        agg: new Map([['3:was1', [{ ...aggOf(3, 'was1', 20), err_rate: 0.1, avg_ms: 250 }]]]),
      }),
    )
    renderPage()
    const strip = await screen.findByLabelText('요약')
    const valueOf = (label: string) => within(strip).getByText(label).nextElementSibling
    await waitFor(() => expect(valueOf('응답/초 (TPS)')).toHaveTextContent('20.0'))
    expect(valueOf('현재 진행 건수')).toHaveTextContent('7')
    expect(valueOf('에러율')).toHaveTextContent('10.0%')
    expect(within(strip).queryByText('요청/초')).toBeNull()
    expect(valueOf('평균 응답')).toHaveTextContent('250ms')
    expect(valueOf('정상')).toHaveClass('text-apm-normal-text')
    expect(valueOf('경고')).toHaveClass('text-apm-warning-text')
    expect(valueOf('심각')).toHaveClass('text-apm-critical-text')
    const order = ['현재 진행 건수', '평균 응답', '정상', '경고', '심각', '응답/초 (TPS)', '에러율']
    const texts = [...strip.querySelectorAll('dt')].map((e) => e.textContent)
    expect(texts).toEqual(order)
  })

  it('데이터가 없는 범위의 위젯은 수신 대기를 보여 준다', async () => {
    renderPage()
    await screen.findByText('평균 응답시간')
    expect(screen.getAllByText('수신 대기').length).toBeGreaterThan(0)
  })
})

describe('호스트 체크박스 (모니터링 포함 여부)', () => {
  const twoInstances = () =>
    useApmLiveStream.mockReturnValue(
      emptyLive({
        agg: new Map([
          ['3:was1', [aggOf(3, 'was1', 7)]],
          ['3:was2', [aggOf(3, 'was2', 5)]],
          ['4:api1', [aggOf(4, 'api1', 1)]],
        ]),
      }),
    )

  it('기본은 모두 체크, 인스턴스 해제 시 그룹은 mixed, 요약·칩에서 빠지고 다시 체크하면 돌아온다', async () => {
    twoInstances()
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const strip = await screen.findByLabelText('요약')
    const all = await within(tree).findByRole('checkbox', { name: /ALL/ })
    const group = within(tree).getByRole('checkbox', { name: '시스템3 전체 포함' })
    const was2 = within(tree).getByRole('checkbox', { name: 'was2 포함' })
    expect(all).toBeChecked()
    expect(group).toBeChecked()
    await waitFor(() => expect(within(strip).getByText('13.0')).toBeInTheDocument())

    await userEvent.click(was2)
    expect(was2).not.toBeChecked()
    expect(group).toHaveAttribute('aria-checked', 'mixed')
    expect(all).toHaveAttribute('aria-checked', 'mixed')
    expect(within(strip).getByText('8.0')).toBeInTheDocument()
    const chips = screen.getByRole('group', { name: '인스턴스 선택' })
    // 범위에 시스템이 둘 이상이면 같은 role 을 구분하도록 "시스템·role" 로 표시한다
    expect(within(chips).getByRole('button', { name: /·was2$/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await userEvent.click(was2)
    expect(within(strip).getByText('13.0')).toBeInTheDocument()
  })

  it('그룹 체크박스는 소속 인스턴스를 한꺼번에, ALL 은 전체를 켜고 끈다', async () => {
    twoInstances()
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    const strip = await screen.findByLabelText('요약')
    const group = await within(tree).findByRole('checkbox', { name: '시스템3 전체 포함' })
    await userEvent.click(group)
    expect(within(tree).getByRole('checkbox', { name: 'was1 포함' })).not.toBeChecked()
    expect(within(tree).getByRole('checkbox', { name: 'was2 포함' })).not.toBeChecked()
    expect(within(tree).getByRole('checkbox', { name: 'api1 포함' })).toBeChecked()
    expect(within(strip).getByText('1.0')).toBeInTheDocument()

    const all = within(tree).getByRole('checkbox', { name: /ALL/ })
    await userEvent.click(all) // mixed -> 전체 선택
    expect(within(strip).getByText('13.0')).toBeInTheDocument()
    await userEvent.click(all) // 전체 해제
    expect(within(tree).getByRole('checkbox', { name: 'api1 포함' })).not.toBeChecked()
    expect(within(strip).getByText('0.0')).toBeInTheDocument()
  })

  it('체크 상태는 사용자별로 localStorage 에 유지되고 새로고침 뒤 복원된다', async () => {
    twoInstances()
    const first = renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    await userEvent.click(await within(tree).findByRole('checkbox', { name: 'was1 포함' }))
    expect(
      JSON.parse(localStorage.getItem('synapse.apmLive.excludedInstances.10') ?? '[]'),
    ).toEqual(['3:was1'])
    first.unmount()

    renderPage()
    const tree2 = await screen.findByRole('complementary', { name: '호스트 목록' })
    expect(await within(tree2).findByRole('checkbox', { name: 'was1 포함' })).not.toBeChecked()
    expect(within(tree2).getByRole('checkbox', { name: 'was2 포함' })).toBeChecked()
    expect(within(await screen.findByLabelText('요약')).getByText('6.0')).toBeInTheDocument()
  })

  it('행 이름을 눌러 범위를 고르는 동작은 체크 상태와 별개로 유지된다', async () => {
    twoInstances()
    renderPage()
    const tree = await screen.findByRole('complementary', { name: '호스트 목록' })
    await userEvent.click(await within(tree).findByRole('checkbox', { name: 'was2 포함' }))
    await userEvent.click(within(tree).getByRole('button', { name: /was2.*WAS/ }))
    expect(within(tree).getByRole('button', { name: /was2.*WAS/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(within(tree).getByRole('checkbox', { name: 'was2 포함' })).not.toBeChecked()
  })
})

describe('ApmLivePage 탭 활성 상태', () => {
  it('활성 탭이면 스트림을 켠다', async () => {
    renderPage('/apm/live', true)
    await screen.findByLabelText('요약')
    expect(useApmLiveStream).toHaveBeenLastCalledWith(expect.any(Array), true)
  })

  it('비활성 탭이면 스트림을 끄고, 다시 활성화하면 켠다', async () => {
    const view = renderPage('/apm/live', false)
    await screen.findByLabelText('요약')
    expect(useApmLiveStream).toHaveBeenLastCalledWith(expect.any(Array), false)
    expect(useApmLiveStream).not.toHaveBeenCalledWith(expect.any(Array), true)
    view.unmount()
    renderPage('/apm/live', true)
    await screen.findByLabelText('요약')
    expect(useApmLiveStream).toHaveBeenLastCalledWith(expect.any(Array), true)
  })

  it('비활성 동안 시계 타이머를 돌리지 않는다', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    renderPage('/apm/live', false)
    await screen.findByLabelText('요약')
    expect(spy.mock.calls.filter(([, ms]) => ms === 5000)).toHaveLength(0)
  })
})
