import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SummaryStrip } from '@/components/apm/live/SummaryStrip'
import { DEFAULT_LAYOUT, LAYOUT_VERSION } from '@/components/apm/live/defaultLayout'
import {
  BALL_R,
  MAX_BACKLOG,
  MAX_PARTICLES,
  TAIL_LEN,
  TRAVEL_MS,
  EXIT_MS,
  MAX_PAUSED,
  PAUSED_R,
  PAUSED_MIN_GAP,
  SPEED_MAX,
  SPEED_MIN,
  MAX_STEP_MS,
  ENTER_SPEED,
  RECOLOR_MS,
  ARRIVE_HOLD_MS,
  capacityOf,
  stepPaused,
  velocityFor,
  zoneBounds,
  advanceFlow,
  advancePaused,
  collectPaused,
  completePaused,
  easeInOut,
  enqueueFlow,
  exitProgress,
  exitPose,
  hashId,
  mixColor,
  newFlow,
  newPaused,
  pulseFactor,
  syncPaused,
  withPlaceholders,
} from '@/lib/apm/flowParticles'
import type { LiveSummary } from '@/lib/apm/liveScope'
import type { LiveActiveEvent, LivePointsEvent } from '@/types/apm'

const summary: LiveSummary = {
  active: 3,
  normal: 2,
  warning: 1,
  critical: 0,
  tps: 4.2,
  avgMs: 120,
  errRate: 1.5,
}

const ev = (role: string, ids: string[], elapsed = 100, error = false): LivePointsEvent => ({
  system_id: 1,
  instance_role: role,
  points: ids.map((id) => ({
    ts: Date.now(),
    elapsed_ms: elapsed,
    error,
    trace_id: `t${id}`,
    span_id: `s${id}`,
  })),
})

let rafCallbacks: FrameRequestCallback[]

beforeEach(() => {
  rafCallbacks = []
  // 공 이동·exit 진행도가 실제 경과 시간(부하에 따라 달라짐)에 좌우되지 않도록 시계를 고정한다
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafCallbacks.push(cb))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    new Proxy(
      {},
      { get: () => () => ({ addColorStop() {} }), set: () => true },
    ) as unknown as CanvasRenderingContext2D,
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SummaryStrip', () => {
  it('기존 수치를 유지하고 canvas 를 렌더링한다', () => {
    render(<SummaryStrip summary={summary} />)
    expect(screen.getByLabelText('요약')).toBeInTheDocument()
    expect(screen.getByText('현재 진행 건수').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('응답/초 (TPS)').nextElementSibling).toHaveTextContent('4.2')
    expect(screen.getByTestId('summary-flow').tagName).toBe('CANVAS')
  })

  it('첫 렌더의 점은 흘리지 않고, 새 트랜잭션만 입자를 만들어 rAF 를 돈다', () => {
    const { rerender } = render(
      <SummaryStrip summary={summary} points={[ev('was1', ['1', '2'])]} keys={['1:was1']} />,
    )
    const canvas = screen.getByTestId('summary-flow')
    expect(canvas.dataset.particles).toBeUndefined()

    rerender(
      <SummaryStrip
        summary={summary}
        points={[ev('was1', ['1', '2']), ev('was1', ['3', '4'])]}
        keys={['1:was1']}
      />,
    )
    expect(canvas.dataset.particles).toBe('2')
    expect(rafCallbacks.length).toBeGreaterThan(0)
    rafCallbacks[0](performance.now())

    // 같은 점을 다시 받아도 중복 생성하지 않는다
    rerender(<SummaryStrip summary={summary} points={[ev('was1', ['3', '4'])]} keys={['1:was1']} />)
    expect(canvas.dataset.particles).toBe('2')
  })

  it('공이 없어도 트랙 기준선을 좌우 안쪽 여백(36px)부터 그리고 대기 점은 그리지 않는다', () => {
    const calls: Array<[string, unknown[]]> = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy(
        {},
        {
          get:
            (_t, prop) =>
            (...args: unknown[]) =>
              void calls.push([String(prop), args]),
          set: () => true,
        },
      ) as unknown as CanvasRenderingContext2D,
    )
    render(<SummaryStrip summary={summary} points={[]} keys={[]} />)
    expect(rafCallbacks.length).toBeGreaterThan(0)
    rafCallbacks[0](performance.now())
    expect(calls.some(([n, a]) => n === 'moveTo' && a[0] === 36)).toBe(true)
    expect(calls.some(([n]) => n === 'lineTo')).toBe(true)
    expect(calls.some(([n]) => n === 'stroke')).toBe(true)
    expect(calls.filter(([n]) => n === 'arc')).toHaveLength(0)
  })

  it('대기열이 여러 건이어도 한 프레임에 공(arc)은 하나만 그린다', () => {
    const calls: Array<[string, unknown[]]> = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy(
        {},
        {
          get:
            (_t, prop) =>
            (...args: unknown[]) => {
              calls.push([String(prop), args])
              return { addColorStop() {} }
            },
          set: () => true,
        },
      ) as unknown as CanvasRenderingContext2D,
    )
    const { rerender } = render(<SummaryStrip summary={summary} points={[]} keys={['1:was1']} />)
    rerender(
      <SummaryStrip
        summary={summary}
        points={[ev('was1', ['1', '2', '3', '4', '5'])]}
        keys={['1:was1']}
        colorVars={new Map([['1:was1', '--t-series-1']])}
      />,
    )
    calls.length = 0
    rafCallbacks.at(-1)!(performance.now())
    // 공 본체 + 중심 광택 = arc 2회(둘 다 같은 하나의 공)
    expect(calls.filter(([n]) => n === 'arc')).toHaveLength(2)
  })

  it('띠에는 셀 테두리·박스가 없고 가는 세로 구분선 두 개만 있다', () => {
    const { container } = render(<SummaryStrip summary={summary} />)
    expect(screen.getAllByTestId('band-divider')).toHaveLength(2)
    // 구분선은 트랙 행 컨테이너 안에만 있고(숫자 영역을 가로지르지 않음), 직접 자식 구분선은 없다
    const track = screen.getByTestId('band-track')
    expect(track.querySelectorAll('[data-testid="band-divider"]')).toHaveLength(2)
    const dl0 = screen.getByLabelText('요약')
    expect(dl0.querySelectorAll(':scope > [data-testid="band-divider"]')).toHaveLength(0)
    expect(container.innerHTML).not.toMatch(/border-t\b/)
    expect(screen.getByText('응답/초 (TPS)').className).toContain('whitespace-nowrap')
    const dl = screen.getByLabelText('요약')
    for (const cell of dl.querySelectorAll(':scope > div:not([data-testid])')) {
      expect(cell.className).not.toMatch(/border|shadow|ring|bg-/)
    }
    // 구분선 그라디언트의 토큰 참조(var(--color-border-alt))는 테두리 클래스가 아니다
    expect(container.innerHTML.replace(/var\(--color-border-alt\)/g, '')).not.toMatch(
      /sm:border-x|\bborder-[xylrtb]?\b/,
    )
  })

  it('공 반지름·꼬리 길이 상수와 띠 높이', () => {
    expect(BALL_R).toBe(18)
    expect(TAIL_LEN).toBe(260)
    expect(PAUSED_R).toBe(15)
    const { container } = render(<SummaryStrip summary={summary} />)
    expect((container.firstElementChild as HTMLElement).className).toContain('sm:h-[132px]')
  })

  it('체크 해제된(범위 밖) 인스턴스의 트랜잭션은 흘리지 않는다', () => {
    const { rerender } = render(<SummaryStrip summary={summary} points={[]} keys={['1:was1']} />)
    rerender(<SummaryStrip summary={summary} points={[ev('was2', ['9'])]} keys={['1:was1']} />)
    expect(screen.getByTestId('summary-flow').dataset.particles).toBeUndefined()
  })

  it('입자는 최대 200개이며 초과분은 오래된 것부터 버린다', () => {
    const ids = Array.from({ length: MAX_PARTICLES + 50 }, (_, i) => String(i))
    const { rerender } = render(<SummaryStrip summary={summary} points={[]} keys={['1:was1']} />)
    rerender(<SummaryStrip summary={summary} points={[ev('was1', ids)]} keys={['1:was1']} />)
    expect(screen.getByTestId('summary-flow').dataset.particles).toBe(String(MAX_PARTICLES))
  })

  it('prefers-reduced-motion 이면 canvas·애니메이션 없이 숫자만 보인다', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }),
    )
    const { rerender } = render(<SummaryStrip summary={summary} points={[]} keys={['1:was1']} />)
    rerender(<SummaryStrip summary={summary} points={[ev('was1', ['1'])]} keys={['1:was1']} />)
    expect(screen.queryByTestId('summary-flow')).not.toBeInTheDocument()
    expect(rafCallbacks).toHaveLength(0)
    expect(screen.getByText('현재 진행 건수').nextElementSibling).toHaveTextContent('3')
  })
})

describe('flowParticles', () => {
  const item = (c: string) => ({ colorVar: c })

  it('공은 한 번에 하나만 흐르고, 끝나야 다음 공이 나온다', () => {
    let st = enqueueFlow(newFlow(), [item('--a'), item('--b')])
    st = advanceFlow(st, 1000)
    expect(st.ball?.colorVar).toBe('--a')
    expect(st.queue).toHaveLength(1)
    st = advanceFlow(st, 1000 + TRAVEL_MS / 2)
    expect(st.ball?.colorVar).toBe('--a')
    st = advanceFlow(st, 1000 + TRAVEL_MS)
    expect(st.ball?.colorVar).toBe('--b')
    st = advanceFlow(st, 1000 + TRAVEL_MS * 2)
    expect(st.ball).toBeNull()
  })

  it(`대기열이 ${MAX_BACKLOG}건을 넘으면 오래된 것을 건너뛰고 최신 건만 남긴다`, () => {
    const many = Array.from({ length: 10 }, (_, i) => item(`--c${i}`))
    const st = advanceFlow(enqueueFlow(newFlow(), many), 0)
    expect(st.ball?.colorVar).toBe(`--c${10 - MAX_BACKLOG}`)
    expect(st.queue).toHaveLength(MAX_BACKLOG - 1)
  })

  it('대기열 상한을 넘으면 오래된 것부터 버린다', () => {
    const st = enqueueFlow(
      newFlow(),
      Array.from({ length: MAX_PARTICLES + 5 }, (_, i) => item(`--c${i}`)),
    )
    expect(st.queue).toHaveLength(MAX_PARTICLES)
    expect(st.queue[0].colorVar).toBe('--c5')
  })

  it('ease-in-out: 양 끝 0/1, 중간 0.5', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5)
    expect(easeInOut(0.1)).toBeLessThan(0.1)
  })
})

describe('DEFAULT_LAYOUT 밀도', () => {
  it('한 행(y)에 위젯이 최대 2개이고 12열을 넘지 않는다', () => {
    const rows = new Map<number, typeof DEFAULT_LAYOUT>()
    for (const w of DEFAULT_LAYOUT) rows.set(w.y, [...(rows.get(w.y) ?? []), w])
    for (const row of rows.values()) {
      expect(row.length).toBeLessThanOrEqual(2)
      expect(row.reduce((n, w) => n + w.w, 0)).toBeLessThanOrEqual(12)
    }
    expect(DEFAULT_LAYOUT).toHaveLength(12)
  })

  it('v4 기본 배치는 운영자 질문 순서(큐+산점도 → 골든 시그널 → 용량 → 드릴다운)이고 크기가 정해져 있다', () => {
    expect(LAYOUT_VERSION).toBe(4)
    expect(DEFAULT_LAYOUT.map((x) => [x.type, x.x, x.y, x.w, x.h])).toEqual([
      ['queue', 0, 0, 7, 5],
      ['scatter', 7, 0, 5, 5],
      ['tps', 0, 5, 6, 4],
      ['avg_ms', 6, 5, 6, 4],
      ['err_rate', 0, 9, 6, 4],
      ['active_list', 6, 9, 6, 4],
      ['jvm_cpu', 0, 13, 6, 4],
      ['jvm_heap_gc', 6, 13, 6, 4],
      ['jvm_users_threads', 0, 17, 6, 4],
      ['jvm_conn_pool', 6, 17, 6, 4],
      ['uri_top', 0, 21, 6, 5],
      ['sql_top', 6, 21, 6, 5],
    ])
  })
})

const act = (elapsed: number[], slow = 1000, role = 'was1'): LiveActiveEvent => ({
  system_id: 1,
  instance_role: role,
  ts: Date.now(),
  slow_ms: slow,
  buckets: [0, 0, 0],
  top: elapsed.map((e, i) => ({
    trace_id: `t${role}${i}`,
    span_id: `s${role}${i}`,
    thread: 'th',
    uri: '/x',
    start_ts: 0,
    elapsed_ms: e,
    phase: '',
    sql: '',
    stack: null,
  })),
})

describe('느린 진행 건 정지 공', () => {
  it('traverse 시간은 3.4초, 대기열 상한은 2건', () => {
    expect(TRAVEL_MS).toBe(3400)
    expect(MAX_BACKLOG).toBe(2)
    const many = Array.from({ length: 6 }, (_, i) => ({ colorVar: `--c${i}` }))
    const st = advanceFlow(enqueueFlow(newFlow(), many), 0)
    expect(st.ball?.colorVar).toBe('--c4')
    expect(st.queue).toHaveLength(1)
  })

  it('경고·심각 건만 모으고 범위 밖 인스턴스·완료된 건은 제외한다', () => {
    const m = new Map([
      ['1:was1', act([100, 1500, 3500])],
      ['1:was2', act([5000], 1000, 'was2')],
    ])
    const got = collectPaused(m, new Set(['1:was1']))
    expect(got.map((g) => g.level)).toEqual(['critical', 'warning'])
    expect(collectPaused(m, new Set(['1:was1']), new Set([got[0].id]))).toHaveLength(1)
  })

  const LO = 100
  const HI = 500
  const MIN = PAUSED_R * 2 + PAUSED_MIN_GAP
  type St = ReturnType<typeof newPaused>
  const tx = (
    id: string,
    level: 'warning' | 'critical' = 'warning',
    e?: number,
    slow?: number,
  ) => ({ id, level, elapsed_ms: e, slow_ms: slow })
  /** dt(ms) 간격으로 n 프레임 진행. 마지막 시각도 함께 돌려준다 */
  const run = (st: St, from: number, frames: number, dt = 16): [St, number] => {
    let t = from
    for (let i = 0; i < frames; i++) {
      t += dt
      st = stepPaused(st, t, LO, HI)
    }
    return [st, t]
  }
  /** 입장 중인 공이 모두 구역에 합류할 때까지 진행 */
  const settle = (st: St, from: number): [St, number] => {
    let t = from
    for (let i = 0; i < 2000 && st.balls.some((b) => b.entering); i++) {
      t += 16
      st = stepPaused(st, t, LO, HI)
    }
    return [st, t]
  }
  /** 구역 안에 정해진 x·속도로 놓인 공(입장 완료)으로 만든다 */
  const placed = (st: St, spec: Array<[number, number]>): St => ({
    ...st,
    lastT: 0,
    balls: st.balls.map((b, i) => ({ ...b, entering: false, x: spec[i][0], v: spec[i][1] })),
  })
  const livesOf = (st: St) => st.balls.filter((b) => b.exitT0 == null).sort((a, b) => a.x - b.x)

  it('속도는 id 해시로 결정되고 18~40px/s 범위이며, 구역 범위는 공 반지름 + 여백만큼 안쪽이다', () => {
    expect(hashId('a:b')).toBe(hashId('a:b'))
    expect(velocityFor('a:b')).toBe(velocityFor('a:b'))
    const speeds = Array.from({ length: 50 }, (_, i) => Math.abs(velocityFor(`t:${i}`)) * 1000)
    for (const v of speeds) {
      expect(v).toBeGreaterThanOrEqual(SPEED_MIN - 1e-9)
      expect(v).toBeLessThanOrEqual(SPEED_MAX + 1e-9)
    }
    expect(new Set(speeds.map((v) => v.toFixed(2))).size).toBeGreaterThan(10)
    const [lo, hi] = zoneBounds(200, 600)
    expect(lo).toBeGreaterThanOrEqual(200 + PAUSED_R)
    expect(hi).toBeLessThanOrEqual(600 - PAUSED_R)
  })

  it('수용 개수는 8개 상한이고 넘치면 overflow, 새 공은 항상 파랑으로 트랙 왼쪽에서 줄 서서 들어온다', () => {
    expect(capacityOf(0, 10_000)).toBe(MAX_PAUSED)
    expect(capacityOf(0, 10)).toBe(1)
    const cur = Array.from({ length: 11 }, (_, i) => tx(`t:${i}`))
    const st = syncPaused(newPaused(), cur, 0, 800, 0, 0, 36)
    expect(st.balls).toHaveLength(MAX_PAUSED)
    expect(st.overflow).toBe(3)
    for (const b of st.balls) {
      expect(b).toMatchObject({ level: 'normal', entering: true })
      expect(b.x).toBeLessThan(0)
    }
    const xs = st.balls.map((b) => b.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(MIN)
    // 같은 목록으로 다시 sync 해도 그대로
    const again = syncPaused(st, cur, 0, 800, 10, 0, 36)
    expect(again.balls.map((b) => [b.id, b.x, b.v])).toEqual(st.balls.map((b) => [b.id, b.x, b.v]))
  })

  it('입장하는 공은 ENTER_SPEED 로 구역에 들어와 합류하고, 앞 공과 최소 간격을 지킨다', () => {
    let st = syncPaused(newPaused(), [tx('a'), tx('b'), tx('c')], LO, HI, 0, 0, 36)
    let t = 0
    const x0 = st.balls[0].x
    st = stepPaused(st, 0, LO, HI)
    t += 40
    st = stepPaused(st, t, LO, HI)
    expect(st.balls[0].x - x0).toBeCloseTo(ENTER_SPEED * 40)
    for (let i = 0; i < 400; i++) {
      t += 16
      st = stepPaused(st, t, LO, HI)
      const all = st.balls.map((b) => b.x).sort((a, b) => a - b)
      for (let k = 1; k < all.length; k++)
        expect(all[k] - all[k - 1]).toBeGreaterThanOrEqual(MIN - 1e-6)
    }
    expect(st.balls.every((b) => !b.entering)).toBe(true)
    for (const b of st.balls) {
      expect(b.x).toBeGreaterThanOrEqual(LO)
      expect(b.x).toBeLessThanOrEqual(HI)
    }
  })

  it('벽에서 반사되고 구분선(구역 경계)에 닿거나 넘지 않는다', () => {
    let [st] = settle(syncPaused(newPaused(), [tx('a'), tx('b'), tx('c')], LO, HI, 0, 0, 36), 0)
    for (let k = 0; k < 40; k++) {
      ;[st] = run(st, k * 1000 + 10_000, 60)
      for (const b of st.balls) {
        expect(b.x).toBeGreaterThanOrEqual(LO)
        expect(b.x).toBeLessThanOrEqual(HI)
      }
    }
    const [lo, hi] = zoneBounds(0, 400)
    const one = syncPaused(newPaused(), [tx('wall')], lo, hi, 0)
    const toRight = stepPaused(placed(one, [[hi - 0.01, 0.03]]), 50, lo, hi)
    expect(toRight.balls[0].x).toBe(hi)
    expect(toRight.balls[0].v).toBeLessThan(0)
    const toLeft = stepPaused(placed(one, [[lo + 0.01, -0.03]]), 50, lo, hi)
    expect(toLeft.balls[0].x).toBe(lo)
    expect(toLeft.balls[0].v).toBeGreaterThan(0)
  })

  it('이웃과 부딪히면 속도를 맞바꾸고 공끼리 절대 겹치지 않는다(최소 간격 유지)', () => {
    const base = syncPaused(newPaused(), [tx('p'), tx('q')], LO, HI, 0)
    const hit = stepPaused(
      placed(base, [
        [200, 0.04],
        [200 + MIN + 0.5, -0.03],
      ]),
      16,
      LO,
      HI,
    )
    const [a, b] = livesOf(hit)
    expect(a.v).toBeCloseTo(-0.03)
    expect(b.v).toBeCloseTo(0.04)
    expect(b.x - a.x).toBeGreaterThanOrEqual(MIN)
    // 여러 공을 오래 돌려도 매 프레임 간격이 유지된다
    const six = Array.from({ length: 6 }, (_, i) => tx(`m:${i}`))
    let [st, t] = settle(syncPaused(newPaused(), six, LO, HI, 0, 0, 36), 0)
    const start = livesOf(st).map((b) => b.x)
    for (let i = 0; i < 6000; i++) {
      t += 16
      st = stepPaused(st, t, LO, HI)
      const xs = livesOf(st).map((x) => x.x)
      for (let k = 1; k < xs.length; k++)
        expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(MIN - 1e-6)
    }
    // 움직인다(정적이지 않다)
    expect(livesOf(st).some((x, i) => Math.abs(x.x - start[i]) > 10)).toBe(true)
  })

  it('프레임 간격은 50ms 로 제한되어 탭 복귀 때 순간이동하지 않는다', () => {
    const st = syncPaused(newPaused(), [tx('slow')], LO, HI, 0)
    const v = Math.abs(velocityFor('slow'))
    const first = stepPaused(placed(st, [[300, v]]), 60_000, LO, HI)
    expect(first.balls[0].x - 300).toBeCloseTo(v * MAX_STEP_MS)
  })

  it('reduced 면 움직이지 않고 균등 간격으로 놓는다', () => {
    let st = syncPaused(newPaused(), [tx('a'), tx('b'), tx('c')], LO, HI, 0)
    st = stepPaused(st, 100, LO, HI, true)
    st = stepPaused(st, 5000, LO, HI, true)
    expect(livesOf(st).map((b) => b.x)).toEqual([LO, (LO + HI) / 2, HI])
  })

  it('지연 건은 파랑으로 들어와 도착한 뒤에야 노랑으로, 이어서 빨강으로 한 단계씩 바뀐다', () => {
    // snapshot(t=0): 경과 3500ms(이미 심각), slow 1000. 그래도 처음엔 파랑이다
    let st = syncPaused(newPaused(), [tx('x:1', 'critical', 3500, 1000)], LO, HI, 0, 0, 36)
    expect(st.balls[0]).toMatchObject({ level: 'normal', want: 'critical', entering: true })
    // 입장 중에는 want 가 높아도 색이 바뀌지 않는다
    st = stepPaused(st, 16, LO, HI)
    st = stepPaused(st, 32, LO, HI)
    expect(st.balls[0]).toMatchObject({ level: 'normal', entering: true })
    const [arrived, tArr] = settle(st, 32)
    // 도착 직후에는 아직 파랑, ARRIVE_HOLD_MS 뒤 파랑 -> 노랑
    expect(arrived.balls[0]).toMatchObject({ level: 'normal', entering: false })
    expect(stepPaused(arrived, tArr + ARRIVE_HOLD_MS - 20, LO, HI).balls[0].level).toBe('normal')
    const yellow = stepPaused(arrived, tArr + ARRIVE_HOLD_MS, LO, HI)
    expect(yellow.balls[0]).toMatchObject({
      level: 'warning',
      prevLevel: 'normal',
      changedAt: tArr + ARRIVE_HOLD_MS,
    })
    // RECOLOR_MS 가 지나기 전에는 빨강으로 가지 않고, 지난 뒤 빨강
    const tY = tArr + ARRIVE_HOLD_MS
    expect(stepPaused(yellow, tY + RECOLOR_MS - 20, LO, HI).balls[0].level).toBe('warning')
    const red = stepPaused(yellow, tY + RECOLOR_MS, LO, HI)
    expect(red.balls[0]).toMatchObject({ level: 'critical', prevLevel: 'warning' })
    expect(ARRIVE_HOLD_MS + RECOLOR_MS).toBeLessThanOrEqual(900)
    // 이후 snapshot 이 경고로 와도 되돌아가지 않는다
    const back = syncPaused(
      red,
      [tx('x:1', 'warning', 3600, 1000)],
      LO,
      HI,
      tArr + 2000,
      tArr + 2000,
    )
    expect(back.balls[0].level).toBe('critical')
    expect(back.balls[0].want).toBe('critical')
  })

  it('경과를 외삽해 3×slow 를 넘는 순간 도착한 공이 빨강으로 바뀐다(전환 간격 RECOLOR_MS 이상)', () => {
    // snapshot(t=1000): 경과 2500ms, slow 1000 -> 3000ms 에 닿는 시각은 t=1500
    let st = placed(
      syncPaused(newPaused(), [tx('e:1', 'warning', 2500, 1000)], LO, HI, 1000, 1000),
      [[300, 0]],
    )
    st = stepPaused(st, 1010, LO, HI)
    expect(st.balls[0]).toMatchObject({ level: 'warning', prevLevel: 'normal', changedAt: 1010 })
    st = stepPaused(st, 1400, LO, HI)
    expect(st.balls[0]).toMatchObject({ level: 'warning', want: 'warning' })
    st = stepPaused(st, 1500, LO, HI)
    expect(st.balls[0]).toMatchObject({
      level: 'critical',
      prevLevel: 'warning',
      want: 'critical',
      changedAt: 1500,
    })
    // 자리표시 공(경과 없음)은 버킷 단계까지만 가고 그 이상은 가지 않는다
    let ph = placed(syncPaused(newPaused(), [tx('ph:warning:0')], LO, HI, 0), [[300, 0]])
    ph = stepPaused(ph, 1_000_000, LO, HI)
    expect(ph.balls[0]).toMatchObject({ level: 'warning', want: 'warning' })
    // 같은 snapshot 으로 다시 sync 해도 외삽이 되감기지 않는다
    const y = placed(syncPaused(newPaused(), [tx('y', 'warning', 2000, 1000)], LO, HI, 0, 0), [
      [300, 0],
    ])
    const re = syncPaused(
      stepPaused(y, 900, LO, HI),
      [tx('y', 'warning', 2000, 1000)],
      LO,
      HI,
      900,
      0,
    )
    expect(re.balls[0].snapAt).toBe(0)
    expect(stepPaused(re, 1000, LO, HI).balls[0].want).toBe('critical')
  })

  it('자리표시도 같은 입장을 거치고(파랑 -> 버킷 단계), 큐 라벨은 최대 단계까지만 간다', () => {
    const st = syncPaused(newPaused(), [tx('ph:critical:0', 'critical')], LO, HI, 0, 0, 36)
    expect(st.balls[0]).toMatchObject({ level: 'normal', want: 'critical', entering: true })
    const [arr, t] = settle(st, 0)
    expect(arr.balls[0].level).toBe('normal')
    const y = stepPaused(arr, t + ARRIVE_HOLD_MS, LO, HI)
    expect(y.balls[0].level).toBe('warning')
    expect(stepPaused(y, t + ARRIVE_HOLD_MS + RECOLOR_MS, LO, HI).balls[0].level).toBe('critical')
  })

  it('실제 구역 폭(lo≈341)에서도 입장 0.8초 이내, 7건이 병렬로 들어와 1.5초 안에 모두 노랑/빨강·최소 간격 유지', () => {
    const lo = 341
    const hi = 570
    const cur = Array.from({ length: 7 }, (_, i) =>
      tx(`p:${i}`, i < 5 ? 'warning' : 'critical', i < 5 ? 1500 : 3500, 1000),
    )
    let st = syncPaused(newPaused(), cur, lo, hi, 0, 0, 36)
    const cap = capacityOf(lo, hi)
    let t = 0
    let firstArrive = Infinity
    let colored = Infinity
    for (let i = 0; i < 200; i++) {
      t += 16
      st = stepPaused(st, t, lo, hi)
      const lives = st.balls.filter((b) => !b.entering)
      if (lives.length && firstArrive === Infinity) firstArrive = t
      const xs = st.balls.map((b) => b.x).sort((a, b) => a - b)
      for (let k = 1; k < xs.length; k++)
        expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(MIN - 1e-6)
      if (colored === Infinity && st.balls.every((b) => b.level === b.want && !b.entering))
        colored = t
    }
    expect(st.balls).toHaveLength(cap)
    expect(firstArrive).toBeLessThanOrEqual(800)
    expect(colored).toBeLessThanOrEqual(1500)
    expect(st.overflow).toBe(7 - cap)
  })

  it('완료되면 오가던 현재 x 에서 오른쪽으로 빠져나가고 EXIT_MS 뒤 사라진다', () => {
    let [st, t] = settle(syncPaused(newPaused(), [tx('x:1')], LO, HI, 0, 0, 36), 0)
    ;[st, t] = run(st, t, 30)
    const x = st.balls[0].x
    st = syncPaused(st, [], LO, HI, 20_000)
    expect(st.balls[0].exitT0).toBe(20_000)
    expect(st.balls[0].x).toBe(x)
    expect(exitPose(st.balls[0], 20_000).x).toBe(x)
    expect(exitPose(st.balls[0], 20_100).x).toBeCloseTo(x + 12)
    // 빠져나가는 동안 stepPaused 는 그 공을 움직이지 않는다
    expect(stepPaused(st, 20_016, LO, HI).balls[0].x).toBe(x)
    expect(exitProgress(st.balls[0], 20_000)).toBe(0)
    expect(exitProgress(st.balls[0], 20_000 + EXIT_MS)).toBe(1)
    expect(advancePaused(st, 20_000 + EXIT_MS / 2).balls).toHaveLength(1)
    expect(advancePaused(st, 20_000 + EXIT_MS).balls).toHaveLength(0)
    const st2 = completePaused(
      syncPaused(newPaused(), [tx('x:1')], LO, HI, 0),
      new Set(['x:1']),
      50,
    )
    expect(st2.balls[0].exitT0).toBe(50)
  })

  it('동시에 완료된 공은 즉시 같이 빠져나가며 간격을 유지하고, 총 이동 60px 이하·빠르게 옅어진다', () => {
    const cur = ['a', 'b', 'c', 'd'].map((id) => tx(id))
    let [st, t] = settle(syncPaused(newPaused(), cur, 0, 800, 0, 0, 36), 0)
    ;[st, t] = run(st, t, 200)
    st = syncPaused(st, [], 0, 800, 50_000)
    expect(new Set(st.balls.map((b) => b.exitT0)).size).toBe(1)
    const ordered = [...st.balls].sort((a, b) => b.x - a.x)
    for (const now of [50_000, 50_100, 50_300, 50_400]) {
      const xs = ordered.map((b) => exitPose(b, now).x)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i - 1] - xs[i]).toBeGreaterThanOrEqual(MIN - 1e-6)
      }
    }
    const b = ordered[0]
    expect(exitPose(b, 50_000 + EXIT_MS).x - b.x).toBeLessThanOrEqual(60)
    expect(exitPose(b, 50_100).alpha).toBeLessThanOrEqual(0.6)
    expect(exitPose(b, 50_200).alpha).toBeLessThanOrEqual(0.5)
    const late = exitPose(b, b.exitT0! + EXIT_MS / 2)
    expect(late.dy).toBeGreaterThan(0)
    expect(late.scale).toBeLessThan(1)
    expect(advancePaused(st, 50_000 + EXIT_MS).balls).toHaveLength(0)
  })

  it('자리표시 <-> 실제 공 교체는 완료가 아니라 같은 자리를 넘겨받고, 사라진 자리표시는 조용히 치운다', () => {
    let [st] = settle(
      syncPaused(newPaused(), [tx('ph:warning:0'), tx('ph:warning:1')], LO, HI, 0, 0, 36),
      0,
    )
    const before = livesOf(st).map((b) => b.x)
    st = syncPaused(st, [tx('t:1', 'warning', 1200, 1000)], LO, HI, 20_000)
    expect(st.balls).toHaveLength(1)
    expect(st.balls[0]).toMatchObject({ id: 't:1', exitT0: null })
    expect(before).toContain(st.balls[0].x)
    st = syncPaused(st, [], LO, HI, 20_100)
    expect(st.balls[0].exitT0).toBe(20_100)
    let st2 = syncPaused(newPaused(), [tx('t:2', 'warning', 1200, 1000)], LO, HI, 0)
    st2 = syncPaused(st2, [tx('ph:warning:0')], LO, HI, 50)
    expect(st2.balls.map((b) => [b.id, b.exitT0, b.elapsed0])).toEqual([
      ['ph:warning:0', null, null],
    ])
  })

  it('자리가 가득 차도 새 심각 건은 가장 뒤 경고 공 자리를 넘겨받아 빨강까지 간다', () => {
    const w = Array.from({ length: 12 }, (_, i) => tx(`w:${i}`, 'warning', 1200, 1e9))
    const cap = capacityOf(LO, HI)
    const [st0, t] = settle(syncPaused(newPaused(), w, LO, HI, 0, 0, 36), 0)
    let st = st0
    expect(livesOf(st)).toHaveLength(cap)
    st = syncPaused(st, [tx('c:1', 'critical', 3500, 1000), ...w], LO, HI, t + 100, t + 100)
    expect(livesOf(st)).toHaveLength(cap)
    expect(
      livesOf(st)
        .filter((b) => b.want === 'critical')
        .map((b) => b.id),
    ).toEqual(['c:1'])
    expect(st.overflow).toBe(w.length + 1 - cap)
  })

  it('churn 이 심해도 공 수는 min(건수, 수용)이고 빠져나가는 공은 EXIT_MS 안에 사라진다', () => {
    let st = newPaused()
    let t = 0
    for (let i = 0; i < 300; i++) {
      t += 100
      const cur = Array.from({ length: 5 }, (_, k) =>
        tx(`t:${Math.floor(i / 2) + k}`, 'warning', 1500, 1000),
      )
      st = advancePaused(stepPaused(syncPaused(st, cur, LO, HI, t, t, 36), t, LO, HI), t)
      expect(livesOf(st).length).toBe(Math.min(5, capacityOf(LO, HI)))
      expect(st.balls.filter((b) => b.exitT0 != null).every((b) => t - b.exitT0! < EXIT_MS)).toBe(
        true,
      )
      const xs = st.balls
        .filter((b) => b.exitT0 == null)
        .map((b) => b.x)
        .sort((a, b) => a - b)
      for (let k = 1; k < xs.length; k++)
        expect(xs[k] - xs[k - 1]).toBeGreaterThanOrEqual(MIN - 1e-6)
    }
  })

  it('버킷 건수가 top 목록보다 크면 모자란 만큼 자리표시 공을 더한다', () => {
    const ev: LiveActiveEvent = { ...act([100, 3500]), buckets: [5, 2, 3] }
    const keys = new Set(['1:was1'])
    const real = collectPaused(new Map([['1:was1', ev]]), keys)
    expect(real.map((r) => r.level)).toEqual(['critical'])
    const all = withPlaceholders(real, new Map([['1:was1', ev]]), keys)
    expect(all.filter((a) => a.level === 'critical')).toHaveLength(3)
    expect(all.filter((a) => a.level === 'warning')).toHaveLength(2)
    expect(all.filter((a) => a.id.startsWith('ph:'))).toHaveLength(4)
    // 범위 밖 인스턴스의 버킷은 세지 않는다
    expect(withPlaceholders([], new Map([['1:was1', ev]]), new Set())).toHaveLength(0)
  })

  it('reduced-motion 이면 맥동이 없다', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)')
    expect(pulseFactor(0, true)).toBe(1)
    expect(pulseFactor(450, true)).toBe(1)
    expect(pulseFactor(450, false)).not.toBe(pulseFactor(0, false))
  })

  it('컴포넌트: active 의 경고·심각 건이 반지름 15 공으로 그려지고 사라지면 exit 한다', () => {
    const arcs: unknown[][] = []
    const fills: string[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy(
        {},
        {
          get:
            (_t, prop) =>
            (...args: unknown[]) => {
              if (prop === 'arc') arcs.push(args)
              return { addColorStop() {} }
            },
          set: (_t, prop, v) => {
            if (prop === 'fillStyle' && typeof v === 'string') fills.push(v)
            return true
          },
        },
      ) as unknown as CanvasRenderingContext2D,
    )
    const m1 = new Map([['1:was1', act([100, 1500, 3500])]])
    const { rerender } = render(<SummaryStrip summary={summary} keys={['1:was1']} active={m1} />)
    const canvas = screen.getByTestId('summary-flow')
    rafCallbacks.at(-1)!(performance.now())
    expect(canvas.dataset.paused).toBe('2')
    expect(arcs.filter((a) => a[2] <= PAUSED_R)).toHaveLength(2)

    // 체크 해제된 인스턴스는 보이지 않는다
    rerender(<SummaryStrip summary={summary} keys={[]} active={m1} />)
    expect(canvas.dataset.paused).toBe('0')

    // 완료되어 active 에서 사라지면 exit 로 전환된다
    rerender(<SummaryStrip summary={summary} keys={['1:was1']} active={m1} />)
    expect(canvas.dataset.paused).toBe('2')
    rerender(<SummaryStrip summary={summary} keys={['1:was1']} active={new Map()} />)
    expect(canvas.dataset.paused).toBe('0')
    arcs.length = 0
    rafCallbacks.at(-1)!(performance.now())
    expect(arcs.filter((a) => a[2] <= PAUSED_R).length).toBeGreaterThan(0)
  })

  it('탭이 숨겨진 동안은 갱신하지 않고, 다시 보이면 현재 snapshot 으로 다시 만든다', () => {
    const m1 = new Map([['1:was1', act([1500])]])
    const { rerender } = render(
      <SummaryStrip summary={summary} keys={['1:was1']} active={m1} paused />,
    )
    const canvas = screen.getByTestId('summary-flow')
    expect(canvas.dataset.paused).toBeUndefined()
    rerender(<SummaryStrip summary={summary} keys={['1:was1']} active={m1} />)
    expect(canvas.dataset.paused).toBe('1')
  })

  it('reduced-motion 에서는 canvas 가 없어 맥동도 없다', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }),
    )
    render(
      <SummaryStrip
        summary={summary}
        keys={['1:was1']}
        active={new Map([['1:was1', act([5000])]])}
      />,
    )
    expect(screen.queryByTestId('summary-flow')).not.toBeInTheDocument()
    expect(rafCallbacks).toHaveLength(0)
  })
})
