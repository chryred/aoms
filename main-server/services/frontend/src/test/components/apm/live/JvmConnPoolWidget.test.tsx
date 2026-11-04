import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { JvmConnPoolWidget } from '@/components/apm/live/widgets/JvmConnPoolWidget'
import { ChartScaleContext } from '@/components/apm/live/chartScale'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { LiveData } from '@/hooks/useApmLiveStream'
import type { LiveAggEvent } from '@/types/apm'

const pool = (name: string, active: number, max: number, wait = 0) => ({
  name,
  kind: 'jeus',
  active,
  idle: Math.max(0, max - active),
  max,
  wait,
})

const agg = (role: string, ts: number, pools: ReturnType<typeof pool>[] | null): LiveAggEvent => ({
  system_id: 1,
  instance_role: role,
  ts,
  tps: 1,
  avg_ms: 1,
  err_rate: 0,
  slow_cnt: 0,
  uri_top: [],
  sql_top: [],
  jvm: pools
    ? {
        conn_active: pools.reduce((s, p) => s + p.active, 0),
        conn_max: pools.reduce((s, p) => s + p.max, 0),
        pools,
      }
    : { threads: 5 },
  dropped: { detail: 0, sql: 0, tx: 0 },
})

const live = (entries: [string, LiveAggEvent[]][]): LiveData => ({
  active: new Map(),
  points: [],
  agg: new Map(entries),
  status: 'live',
})

const target = { systemIds: [1] }
const renderW = (data: LiveData, t = target, scale = 1) =>
  render(
    <ChartScaleContext.Provider value={scale}>
      <JvmConnPoolWidget events={data} target={t} slowMs={3000} />
    </ChartScaleContext.Provider>,
  )

describe('JvmConnPoolWidget', () => {
  it('풀 정보가 없으면 정확한 안내 문구를 보인다', () => {
    renderW(live([['1:was1', [agg('was1', 1000, null)]]]))
    expect(
      screen.getByText('커넥션 풀 정보가 없습니다 (Agent-T 버전 또는 풀 MBean 미노출)'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('pool-list')).toBeNull()
  })

  it('사용률 내림차순으로 이름·active/max·대기를 보이고 임계값 색을 입힌다', () => {
    const pools = [
      pool('low', 3, 30), // 10% normal
      pool('warn', 24, 30), // 80% warning
      pool('full', 5, 5, 2), // 100% + wait critical
      pool('waitonly', 1, 30, 1), // 대기만 있어도 critical
    ]
    renderW(live([['1:was1', [agg('was1', 1000, pools)]]]))
    const rows = screen.getAllByTestId('pool-row')
    expect(rows.map((r) => within(r).getAllByText(/./)[0].textContent)).toEqual([
      'full',
      'warn',
      'low',
      'waitonly',
    ])
    expect(rows.map((r) => r.getAttribute('data-level'))).toEqual([
      'critical',
      'warning',
      'normal',
      'critical',
    ])
    expect(within(rows[0]).getByText('5/5')).toBeInTheDocument()
    expect(within(rows[0]).getByTestId('pool-wait')).toHaveTextContent('대기 2')
    expect(within(rows[1]).queryByTestId('pool-wait')).toBeNull()
    const bars = screen.getAllByTestId('pool-bar')
    expect(bars[0].style.width).toBe('100%')
    expect(bars[0].style.background).toContain('--color-apm-critical')
    expect(bars[1].style.background).toContain('--color-apm-warning')
    expect(bars[2].style.background).toContain('--color-apm-normal')
    expect(bars[2].style.width).toBe('10%')
    expect(bars[3].style.background).toContain('--color-apm-critical')
  })

  it('상위 5개만 보이고 나머지는 "외 n개", 확대 오버레이에서는 더 보인다', () => {
    const pools = Array.from({ length: 8 }, (_, i) => pool(`p${i}`, i, 10))
    const data = live([['1:was1', [agg('was1', 1000, pools)]]])
    const { unmount } = renderW(data)
    expect(screen.getAllByTestId('pool-row')).toHaveLength(5)
    expect(screen.getByTestId('pool-more')).toHaveTextContent('외 3개')
    unmount()
    renderW(data, target, 1.2)
    expect(screen.getAllByTestId('pool-row')).toHaveLength(8)
    expect(screen.queryByTestId('pool-more')).toBeNull()
  })

  it('max 를 모르는 풀(0)은 active/- 로 표시하고 막대는 비운다', () => {
    renderW(live([['1:was1', [agg('was1', 1000, [pool('nolimit', 4, 0)])]]]))
    expect(screen.getByText('4/-')).toBeInTheDocument()
    expect(screen.getByTestId('pool-bar').style.width).toBe('0%')
  })

  it('최신 이벤트에 풀이 없으면(jvm 5초 주기) 직전 값을 쓴다', () => {
    renderW(
      live([['1:was1', [agg('was1', 1000, [pool('sic_DS', 7, 30)]), agg('was1', 6000, null)]]]),
    )
    expect(screen.getByText('sic_DS')).toBeInTheDocument()
  })

  it('여러 인스턴스를 고르면 "인스턴스 · 풀" 로 표시하고 target 범위를 따른다', () => {
    const data = live([
      ['1:was1', [agg('was1', 1000, [pool('sic_DS', 7, 30)])]],
      ['1:was2', [agg('was2', 1000, [pool('sic_DS', 28, 30)])]],
      ['2:other', [{ ...agg('other', 1000, [pool('x', 1, 2)]), system_id: 2 }]],
    ])
    const ctx = {
      queueFilter: null,
      setQueueFilter: () => {},
      systemName: (id: number) => `#${id}`,
      colorOf: () => '--color-accent',
      instanceLabel: (_id: number, role: string) => role,
      labelOf: (key: string) => key.split(':')[1],
    }
    render(
      <LiveContext.Provider value={ctx}>
        <JvmConnPoolWidget events={data} target={target} slowMs={3000} />
      </LiveContext.Provider>,
    )
    const rows = screen.getAllByTestId('pool-row')
    expect(rows).toHaveLength(2)
    // 풀 이름이 주, 인스턴스는 보조 줄 (title 은 전체 이름을 유지)
    expect(within(rows[0]).getByTestId('pool-name')).toHaveTextContent('sic_DS')
    expect(within(rows[0]).getByTestId('pool-instance')).toHaveTextContent('was2')
    expect(rows[0]).toHaveAttribute('title', 'was2 · sic_DS')
    expect(within(rows[1]).getByTestId('pool-instance')).toHaveTextContent('was1')
    expect(screen.queryByText(/other/)).toBeNull()
  })

  it('instanceKeys 로 한 인스턴스만 고르면 풀 이름만 보인다', () => {
    const data = live([
      ['1:was1', [agg('was1', 1000, [pool('sic_DS', 7, 30)])]],
      ['1:was2', [agg('was2', 1000, [pool('sic_DS', 28, 30)])]],
    ])
    renderW(data, { systemIds: [1], instanceKeys: ['1:was1'] })
    const rows = screen.getAllByTestId('pool-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('sic_DS')
    expect(rows[0]).not.toHaveTextContent('·')
    expect(within(rows[0]).queryByTestId('pool-instance')).toBeNull()
  })

  it('합계만 있고 pools 가 비면(없으면) 차트와 "풀별 정보 없음" 을 보인다', () => {
    const e = agg('was1', 1000, null)
    e.jvm = { conn_active: 4, conn_max: 30 }
    renderW(live([['1:was1', [e]]]))
    expect(screen.getByText('풀별 정보 없음')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '추이 차트' })).toBeInTheDocument()
    expect(screen.queryByTestId('pool-list')).toBeNull()
    expect(screen.queryByText(/커넥션 풀 정보가 없습니다/)).toBeNull()
  })

  it('pools 가 빈 배열이어도 합계가 있으면 같은 상태를 보인다', () => {
    const e = agg('was1', 1000, null)
    e.jvm = { conn_active: 4, conn_max: 30, pools: [] }
    renderW(live([['1:was1', [e]]]))
    expect(screen.getByText('풀별 정보 없음')).toBeInTheDocument()
    expect(screen.queryByTestId('pool-row')).toBeNull()
  })

  it('합계도 풀도 없으면 빈 상태 문구만 보이고 "풀별 정보 없음" 은 없다', () => {
    renderW(live([['1:was1', [agg('was1', 1000, null)]]]))
    expect(screen.queryByText('풀별 정보 없음')).toBeNull()
  })
})
