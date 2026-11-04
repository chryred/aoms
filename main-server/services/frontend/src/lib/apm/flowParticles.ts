import type { LiveActiveEvent, LivePointsEvent } from '@/types/apm'
import { instanceKey } from '@/lib/apm/liveData'
import { queueColor } from '@/lib/apm/queueBuckets'

/** 대기 중인 공 하나 = 완료된 트랜잭션 하나. 색은 그 트랜잭션을 만든 인스턴스의 시리즈 색(CSS 변수). */
export interface FlowItem {
  colorVar: string
}

export interface FlowBall extends FlowItem {
  /** 출발 시각 (performance.now 기준 ms) */
  t0: number
}

/** 화면에는 항상 공 하나만 흐른다. 나머지는 대기열에서 순서를 기다린다. */
export interface FlowState {
  queue: FlowItem[]
  ball: FlowBall | null
}

/** 공 반지름(px, 1x 기준) */
export const BALL_R = 18
/** 꼬리 길이(px) */
export const TAIL_LEN = 260

/** 대기열 상한. 넘으면 오래된 것부터 버린다. */
export const MAX_PARTICLES = 200
/** 공 하나가 왼쪽 끝에서 오른쪽 끝까지(꼬리 포함) 흐르는 시간 */
export const TRAVEL_MS = 3400
/** 다음 공을 꺼낼 때 대기열이 이보다 길면 오래된 것을 건너뛰고 최신 건만 남긴다(몰림 방지) */
export const MAX_BACKLOG = 2
/** 이보다 오래된 점(재연결 snapshot 등)은 흘려보내지 않는다 */
const MAX_AGE_MS = 15_000

export const newFlow = (): FlowState => ({ queue: [], ball: null })

export const flowCount = (s: FlowState): number => s.queue.length + (s.ball ? 1 : 0)

/** 거의 선형이되 시작·끝만 부드러운 이징(smoothstep 과 선형을 섞음). 긴 이동에서 가속이 거슬리지 않는다. */
export const easeInOut = (t: number): number => {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const smooth = t * t * (3 - 2 * t)
  return 0.4 * t + 0.6 * smooth
}

/**
 * 새로 도착한 완료 트랜잭션을 대기 항목으로 바꾼다. seen 은 중복 방지용(호출자가 유지)이며,
 * keys 밖 인스턴스의 점도 seen 에는 기록해 두어 범위를 넓혀도 과거 점이 갑자기 쏟아지지 않게 한다.
 */
export function collectNewFlow(
  events: LivePointsEvent[],
  seen: Set<string>,
  keys: Set<string>,
  colorOf: (key: string) => string | undefined,
  nowMs: number,
): FlowItem[] {
  const out: FlowItem[] = []
  for (const ev of events) {
    const key = instanceKey(ev)
    const inScope = keys.has(key)
    for (const p of ev.points) {
      const id = `${p.trace_id}:${p.span_id}`
      if (seen.has(id)) continue
      seen.add(id)
      if (!inScope || nowMs - p.ts > MAX_AGE_MS) continue
      out.push({ colorVar: colorOf(key) ?? '--color-accent' })
    }
  }
  return out
}

/** 대기열에 추가. 상한(MAX_PARTICLES)을 넘으면 가장 오래된 것부터 버린다. */
export function enqueueFlow(state: FlowState, added: FlowItem[]): FlowState {
  const queue = [...state.queue, ...added]
  return {
    ...state,
    queue: queue.length > MAX_PARTICLES ? queue.slice(queue.length - MAX_PARTICLES) : queue,
  }
}

/**
 * 시간을 한 틱 진행한다. 공이 끝까지 흘렀으면 치우고, 비어 있으면 대기열에서 다음 공을 꺼낸다.
 * 대기열이 MAX_BACKLOG 보다 길면 오래된 것을 건너뛴다.
 */
export function advanceFlow(state: FlowState, perfNow: number): FlowState {
  let { queue, ball } = state
  if (ball && perfNow - ball.t0 >= TRAVEL_MS) ball = null
  if (!ball && queue.length > 0) {
    if (queue.length > MAX_BACKLOG) queue = queue.slice(queue.length - MAX_BACKLOG)
    ball = { ...queue[0], t0: perfNow }
    queue = queue.slice(1)
  }
  return ball === state.ball && queue === state.queue ? state : { queue, ball }
}

// ── 느린 진행 건(경고·심각) 멈춘 공: 가운데 구역을 천천히 오가는 1차원 운동 ───────────────

/** 정지 공 반지름(px) */
export const PAUSED_R = 15
/** 가운데 구역에 동시에 보이는 공 상한. 넘치면 "+N" 으로만 표시 */
export const MAX_PAUSED = 8
/** 수용 개수 계산용 공 사이 간격(px). 실제 최소 간격(PAUSED_MIN_GAP)보다 넉넉히 잡아 오갈 여유를 남긴다 */
export const PAUSED_GAP = 20
/** 공끼리 절대 좁혀지지 않는 최소 간격(가장자리 기준, px) */
export const PAUSED_MIN_GAP = 6
/** 구분선(구역 경계)과 공 가장자리 사이 여백(px). 공은 구분선에 닿거나 넘지 않는다 */
export const WALL_PAD = 8
/** 오가는 속도 범위(px/s). id 해시로 공마다 결정적으로 다르다 */
export const SPEED_MIN = 18
export const SPEED_MAX = 40
/** 프레임 간격 상한(ms). 탭 전환 뒤 공이 순간이동하지 않도록 */
export const MAX_STEP_MS = 50
/** 새 공이 트랙 왼쪽에서 가운데 구역으로 들어오는 속도(px/ms). 띠 폭 1440 기준 입장에 약 0.7초 */
export const ENTER_SPEED = 0.5
/** 줄 뒤쪽 공이 따라잡는 목표 시간(ms): 뒤쪽 공일수록 빨리 달려 앞 공과 최소 간격으로 붙어 들어온다 */
export const ENTER_CATCHUP_MS = 700
/** 구역에 도착한 공이 이웃을 밀어낼 때 이웃에 주는 속도(px/ms). 이후 자기 속도로 서서히 돌아온다 */
export const PUSH_SPEED = 0.12
/** 밀려난 공이 자기 속도로 돌아오는 감속(px/ms²) */
export const PUSH_DECEL = 0.0002
/** 도착한 공이 첫 색 전환을 시작하기까지의 대기(ms) */
export const ARRIVE_HOLD_MS = 250
/** 완료된 멈춘 공이 빠져나가며 사라지는 시간. 짧게 끝나 화면에 오래 남지 않는다 */
export const EXIT_MS = 450
/** 빠져나가는 공의 이동 속도(px/ms). 모든 공이 같은 속도라 서로 가까워지지 않고, 총 이동은 약 54px */
export const EXIT_SPEED = 0.12
/** 빠져나가는 공이 트랙 아래로 내려가는 깊이(PAUSED_R 배수). 띠 하단(트랙 중심에서 32px)을 넘어 잘리지 않도록 0.2 로 제한(상하 여백 14px 유지) */
export const EXIT_DRIFT = 0.2
/** 경고 -> 심각 색 전환 시간 */
export const RECOLOR_MS = 300
/** 정지 공 글로우 맥동 주기 */
export const PULSE_MS = 1800

/** 공의 표시 단계: 시작은 항상 normal(옅은 파랑), 지연되면 warning(노랑) -> critical(빨강) 으로 바뀐다 */
export type PausedLevel = 'normal' | 'warning' | 'critical'
const RANK: Record<PausedLevel, number> = { normal: 0, warning: 1, critical: 2 }
const maxLevel = (a: PausedLevel, b: PausedLevel): PausedLevel => (RANK[a] >= RANK[b] ? a : b)

export interface PausedTx {
  id: string
  /** 이 건이 도달한 단계(snapshot 기준). 공은 이 단계를 향해 한 단계씩 색이 바뀐다 */
  level: Exclude<PausedLevel, 'normal'>
  /** snapshot 시점 경과(ms)·느림 기준. 자리표시 공은 없다 */
  elapsed_ms?: number
  slow_ms?: number
}

export interface PausedBall {
  id: string
  /** 지금 표시 중인 단계. 구역에 도착하기 전에는 항상 normal */
  level: PausedLevel
  /** 도달해야 하는 단계(snapshot + 로컬 외삽). level 이 이보다 낮으면 구역에 도착한 뒤 한 단계씩 따라간다 */
  want: PausedLevel
  /** true 면 트랙 왼쪽에서 구역으로 들어오는 중(충돌·벽 적용 전) */
  entering: boolean
  /** 색 전환 직전 단계(전환 중에만 의미 있음)와 전환 시작 시각 */
  prevLevel: PausedLevel
  changedAt: number
  /** 완료되어 오른쪽으로 빠져나가는 중이면 시작 시각 */
  exitT0: number | null
  /** 현재 중심 x(px, 띠 좌표)와 속도(px/ms, 부호=방향). 빠져나가는 공은 x 가 출발 위치로 고정된다 */
  x: number
  v: number
  /** snapshot 경과(ms)·느림 기준·snapshot 수신 시각. 경과는 elapsed0 + (now - snapAt) 로 외삽한다 */
  elapsed0: number | null
  slowMs: number | null
  snapAt: number
}

export interface PausedState {
  balls: PausedBall[]
  /** 자리가 모자라 그리지 못한 멈춘 건수 */
  overflow: number
  /** 마지막 step 시각(프레임 델타 계산용) */
  lastT: number | null
}

export const newPaused = (): PausedState => ({ balls: [], overflow: 0, lastT: null })

/** 문자열 해시(FNV-1a). 같은 id 는 항상 같은 값 */
export function hashId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** id 별 결정적 속도(px/ms, 부호=초기 방향). 크기는 SPEED_MIN~SPEED_MAX px/s */
export function velocityFor(id: string): number {
  const h = hashId(id)
  const speed = SPEED_MIN + (((h >>> 3) % 1001) / 1000) * (SPEED_MAX - SPEED_MIN)
  return ((h & 1 ? 1 : -1) * speed) / 1000
}

/** 구역 [x0, x1](두 구분선 사이) 안에서 공 중심이 움직일 수 있는 범위. 공 반지름 + 여백만큼 안쪽 */
export function zoneBounds(x0: number, x1: number): readonly [number, number] {
  const lo = x0 + PAUSED_R + WALL_PAD
  const hi = x1 - PAUSED_R - WALL_PAD
  return hi >= lo ? [lo, hi] : [(x0 + x1) / 2, (x0 + x1) / 2]
}

/** 범위 [lo, hi] 에 동시에 보일 수 있는 공 수 (1~MAX_PAUSED) */
export function capacityOf(lo: number, hi: number): number {
  const pitch = PAUSED_R * 2 + PAUSED_GAP
  return Math.max(1, Math.min(MAX_PAUSED, Math.floor((hi - lo) / pitch) + 1))
}

const MIN_DIST = PAUSED_R * 2 + PAUSED_MIN_GAP

/** 오른쪽부터 빠져나가는 순서 등에서 쓰는 정렬 보조 */
const byX = (a: PausedBall, b: PausedBall) => a.x - b.x

/**
 * 공 중심을 [lo, hi] 안으로 모으고 인접 간격을 MIN_DIST 이상으로 벌린다(위치 보정, 속도는 건드리지 않음).
 * 오른쪽으로 한 번 밀고 왼쪽으로 한 번 당기므로 수용 개수 이내면 항상 겹침 없이 끝난다. live 는 제자리 수정된다.
 */
function separate(live: PausedBall[], lo: number, hi: number): void {
  live.sort(byX)
  for (let i = 0; i < live.length; i++) {
    let x = Math.min(hi, Math.max(lo, live[i].x))
    if (i > 0) x = Math.max(x, live[i - 1].x + MIN_DIST)
    live[i].x = x
  }
  for (let i = live.length - 1; i >= 0; i--) {
    let x = Math.min(live[i].x, hi)
    if (i < live.length - 1) x = Math.min(x, live[i + 1].x - MIN_DIST)
    live[i].x = Math.max(lo, x)
  }
}

/**
 * 서버 버킷(경고·심각 건수 합)이 top-N 목록의 건수보다 크면 모자란 만큼 id 없는 자리표시 공을 더한다.
 * 띠의 숫자(버킷)와 멈춘 공의 개수를 맞추기 위한 것이다. 자리표시 id 는 단계·순번으로 고정.
 */
export function withPlaceholders(
  real: PausedTx[],
  active: ReadonlyMap<string, LiveActiveEvent>,
  keys: ReadonlySet<string>,
): PausedTx[] {
  const bucket = { warning: 0, critical: 0 }
  for (const [key, ev] of active) {
    if (!keys.has(key)) continue
    bucket.warning += ev.buckets?.[1] ?? 0
    bucket.critical += ev.buckets?.[2] ?? 0
  }
  const out = [...real]
  for (const level of ['critical', 'warning'] as const) {
    const have = real.filter((r) => r.level === level).length
    for (let i = 0; i < bucket[level] - have; i++) out.push({ id: `ph:${level}:${i}`, level })
  }
  return out
}

/**
 * 진행 중(active.top) 중 경고 이상인 건을 모은다. 기준은 큐 위젯과 같은 queueColor(elapsed, slow_ms).
 * keys 밖 인스턴스와 completed(이미 완료로 확인된 id)는 제외한다.
 */
export function collectPaused(
  active: ReadonlyMap<string, LiveActiveEvent>,
  keys: ReadonlySet<string>,
  completed?: ReadonlySet<string>,
): PausedTx[] {
  const out: PausedTx[] = []
  for (const [key, ev] of active) {
    if (!keys.has(key)) continue
    for (const t of ev.top ?? []) {
      const level = queueColor(t.elapsed_ms, ev.slow_ms)
      if (level === 'normal') continue
      const id = `${t.trace_id}:${t.span_id}`
      if (completed?.has(id)) continue
      out.push({ id, level, elapsed_ms: t.elapsed_ms, slow_ms: ev.slow_ms })
    }
  }
  // 오래 걸린(심각) 건이 자리를 먼저 차지하도록, 같은 단계 안에서는 id 순으로 고정
  return out.sort((a, b) =>
    a.level === b.level
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.level === 'critical'
        ? -1
        : 1,
  )
}

/**
 * 현재 진행 중인 느린 건 목록에 맞춰 멈춘 공 상태를 갱신한다.
 * - 새 건: 항상 옅은 파랑(normal)으로 트랙 왼쪽(enterX)에서 들어온다. 노랑·빨강은 구역에 도착한 뒤 stepPaused 가
 *   경과 시간에 따라 한 단계씩 바꾼다(처음부터 노랑·빨강으로 튀어나오지 않는다).
 * - 사라진 건: 현재 x 에서 빠져나가기 시작(exit). 자리표시 공은 완료 연출 없이 조용히 사라진다.
 * - 단계가 올라간 건: want 만 올린다. 한 번 올라간 단계는 같은 id 에서 내려가지 않는다.
 * - snapAt: current 의 경과(ms)를 받은 시각. 같은 snapshot 으로 다시 호출해도 외삽이 되감기지 않도록 호출자가 유지한다.
 * 구역 범위 [lo, hi] 가 바뀌면(리사이즈) 구역 안의 공을 새 범위로 모으고, 수용 개수를 넘는 공은 overflow 로 센다.
 */
export function syncPaused(
  state: PausedState,
  current: PausedTx[],
  lo: number,
  hi: number,
  perfNow: number,
  snapAt: number = perfNow,
  enterX: number = lo - 4 * MIN_DIST,
): PausedState {
  const byId = new Map(current.map((c) => [c.id, c]))
  const order = new Map(current.map((c, i) => [c.id, i]))
  const cap = capacityOf(lo, hi)
  const out: PausedBall[] = []
  const leaving = new Set<string>()
  let kept: PausedBall[] = []
  // 자리표시 공 <-> 실제 공 id 교체는 완료가 아니다(top-N 목록이 돌며 같은 건이 번갈아 보이는 것).
  // 사라진 공과 새로 생긴 건 중 한쪽이 자리표시이고 도달 단계가 같으면 그 자리·속도를 그대로 넘겨받는다.
  const have0 = new Set(state.balls.filter((b) => b.exitT0 == null).map((b) => b.id))
  const fresh = current.filter((c) => !have0.has(c.id))
  const rename = new Map<string, PausedTx>()
  const gone = state.balls
    .filter((b) => b.exitT0 == null && !byId.has(b.id))
    .sort((a, b) => a.x - b.x)
  for (const b of gone) {
    const i = fresh.findIndex(
      (c) => c.level === b.want && (c.id.startsWith('ph:') || b.id.startsWith('ph:')),
    )
    if (i >= 0) rename.set(b.id, fresh.splice(i, 1)[0])
  }
  for (const b0 of state.balls) {
    const adopt = rename.get(b0.id)
    const b = adopt ? { ...b0, id: adopt.id } : b0
    const cur = adopt ?? byId.get(b.id)
    if (b.exitT0 != null) {
      out.push(b)
    } else if (!cur) {
      if (!b.id.startsWith('ph:')) {
        out.push(b)
        leaving.add(b.id)
      }
    } else {
      const ph = cur.id.startsWith('ph:')
      kept.push({
        ...b,
        want: maxLevel(b.want, cur.level),
        elapsed0: cur.elapsed_ms ?? (ph ? null : b.elapsed0),
        slowMs: cur.slow_ms ?? (ph ? null : b.slowMs),
        snapAt: cur.elapsed_ms != null ? snapAt : b.snapAt,
      })
    }
  }
  // 수용 개수를 넘으면(구역이 좁아짐) 심각·오래된 건 순(current 순서)으로 남기고 나머지는 overflow
  kept.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
  let overflow = Math.max(0, kept.length - cap)
  kept = kept.slice(0, cap)
  const have = new Set(kept.map((b) => b.id))
  // 새 공은 이미 입장 중인 공의 뒤(왼쪽)에 줄을 선다
  let nextX = Math.min(enterX, lo - MIN_DIST)
  for (const b of kept) if (b.entering) nextX = Math.min(nextX, b.x - MIN_DIST)
  for (const c of current) {
    if (have.has(c.id)) continue
    if (kept.length >= cap) {
      // 자리가 없어도 심각 건은 숨기지 않는다: 가장 뒤 순서의 경고 공 자리를 넘겨받아 빨강까지 변한다
      let victim: PausedBall | undefined
      if (c.level === 'critical')
        for (let i = kept.length - 1; i >= 0 && !victim; i--)
          if (kept[i].want === 'warning') victim = kept[i]
      if (victim) {
        Object.assign(victim, {
          id: c.id,
          want: 'critical',
          elapsed0: c.elapsed_ms ?? null,
          slowMs: c.slow_ms ?? null,
          snapAt,
        })
      }
      overflow++
      continue
    }
    const spawnX = nextX
    nextX -= MIN_DIST
    kept.push({
      id: c.id,
      level: 'normal',
      want: c.level,
      entering: true,
      prevLevel: 'normal',
      changedAt: -Infinity,
      exitT0: null,
      // 한꺼번에 들어오는 공은 줄을 서서(최소 간격) 들어온다
      x: spawnX,
      v: velocityFor(c.id),
      elapsed0: c.elapsed_ms ?? null,
      slowMs: c.slow_ms ?? null,
      snapAt,
    })
  }
  separate(
    kept.filter((b) => !b.entering),
    lo,
    hi,
  )
  return { ...state, balls: scheduleExits([...out, ...kept], leaving, perfNow), overflow }
}

/**
 * 프레임 하나만큼 운동을 진행한다(dt = 이전 step 과의 간격, MAX_STEP_MS 로 제한).
 * - 입장: entering 공은 ENTER_SPEED 로 오른쪽으로 들어오다가 구역 시작점에 닿으면(앞 공과 간격이 있을 때) 합류한다.
 * - 이동: 구역 안의 공은 x += v·dt, 벽(구역 범위)에 닿으면 반사.
 * - 충돌: 이웃과 MIN_DIST 안으로 들어오면 서로 다가가는 중일 때 속도를 맞바꾼다(같은 질량 1차원 탄성충돌),
 *   겹친 만큼은 위치 보정으로 벌려 겹치지 않는다.
 * - 색: snapshot 경과를 외삽해(elapsed0 + now - snapAt) want 를 올리고, 구역에 도착한 공만 RECOLOR_MS 간격으로
 *   normal -> warning -> critical 로 한 단계씩 전환한다.
 * reduced 이면 움직이지 않고 구역에 균등 간격으로 놓는다. 빠져나가는 공은 건드리지 않는다.
 */
export function stepPaused(
  state: PausedState,
  perfNow: number,
  lo: number,
  hi: number,
  reduced = false,
): PausedState {
  const dt = state.lastT == null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, perfNow - state.lastT))
  const balls = state.balls.map((b) => ({ ...b }))
  const alive = balls.filter((b) => b.exitT0 == null)
  if (reduced) {
    const live = alive.sort(byX)
    live.forEach((b, i) => {
      b.entering = false
      b.v = 0
      b.x = live.length > 1 ? lo + (i / (live.length - 1)) * (hi - lo) : (lo + hi) / 2
    })
  } else {
    const live = alive.filter((b) => !b.entering)
    for (const b of live) {
      // 밀려나 빨라진 공은 자기 속도로 서서히 돌아온다
      const base = Math.abs(velocityFor(b.id))
      const mag = Math.abs(b.v)
      if (mag > base) b.v = Math.sign(b.v) * Math.max(base, mag - PUSH_DECEL * dt)
      b.x += b.v * dt
      if (b.x < lo) {
        b.x = lo
        b.v = Math.abs(b.v)
      } else if (b.x > hi) {
        b.x = hi
        b.v = -Math.abs(b.v)
      }
    }
    live.sort(byX)
    for (let i = 0; i + 1 < live.length; i++) {
      const a = live[i]
      const b = live[i + 1]
      if (b.x - a.x < MIN_DIST && a.v > b.v) [a.v, b.v] = [b.v, a.v]
    }
    separate(live, lo, hi)
    // 위치 보정으로 벽에 붙은 공이 벽 쪽으로 향하고 있으면 다음 프레임에 파고들지 않게 미리 돌린다
    for (const b of live) {
      if (b.x <= lo && b.v < 0) b.v = -b.v
      else if (b.x >= hi && b.v > 0) b.v = -b.v
    }
    // 입장 중인 공: 입장 중인 앞 공과만 MIN_DIST 간격을 지키며 병렬로 들어온다.
    // 구역 안 공과 가까워지면 그 공을 앞으로 밀어내(속도 PUSH_SPEED) 자리를 만든다 — 기다리지 않는다.
    const entering = alive.filter((b) => b.entering).sort((a, b) => b.x - a.x)
    for (const e of entering) {
      let ahead: PausedBall | undefined
      for (const o of entering) if (o !== e && o.x > e.x && (!ahead || o.x < ahead.x)) ahead = o
      const speed = Math.max(ENTER_SPEED, (lo - e.x) / ENTER_CATCHUP_MS)
      e.x = Math.min(e.x + speed * dt, ahead ? ahead.x - MIN_DIST : Infinity)
      for (const s of live) {
        if (s.x - e.x < MIN_DIST && s.x > e.x - MIN_DIST) {
          s.x = e.x + MIN_DIST
          s.v = Math.max(s.v, PUSH_SPEED)
        }
      }
    }
    separate(live, lo, hi)
    for (const e of entering) {
      if (e.x < lo) continue
      e.entering = false
      e.v = Math.abs(e.v)
      // 도착 후 ARRIVE_HOLD_MS 가 지나면 첫 색 전환(게이트는 changedAt + RECOLOR_MS)
      e.changedAt = perfNow + ARRIVE_HOLD_MS - RECOLOR_MS
      live.push(e)
    }
  }
  for (const b of alive) {
    if (b.elapsed0 != null && b.slowMs != null) {
      b.want = maxLevel(b.want, queueColor(b.elapsed0 + (perfNow - b.snapAt), b.slowMs))
    }
    if (b.entering || RANK[b.level] >= RANK[b.want] || perfNow - b.changedAt < RECOLOR_MS) continue
    b.prevLevel = b.level
    b.level = b.level === 'normal' ? 'warning' : 'critical'
    b.changedAt = perfNow
  }
  return { ...state, balls, lastT: perfNow }
}

/** leaving 에 속한 살아있는 공의 exit 를 즉시 시작한다. 모두 같은 속도라 빠져나가는 동안 간격이 유지된다 */
function scheduleExits(
  balls: PausedBall[],
  leaving: ReadonlySet<string>,
  perfNow: number,
): PausedBall[] {
  if (leaving.size === 0) return balls
  return balls.map((b) => (leaving.has(b.id) ? { ...b, exitT0: perfNow } : b))
}

/** 빠져나가기를 끝낸 공을 치운다 */
export function advancePaused(state: PausedState, perfNow: number): PausedState {
  const balls = state.balls.filter((b) => b.exitT0 == null || perfNow - b.exitT0 < EXIT_MS)
  return balls.length === state.balls.length ? state : { ...state, balls }
}

/** 특정 id 들을 완료로 처리(즉시 exit 시작). 완료 이벤트가 다음 active 스냅샷보다 먼저 올 때 쓴다 */
export function completePaused(
  state: PausedState,
  ids: ReadonlySet<string>,
  perfNow: number,
): PausedState {
  if (!state.balls.some((b) => b.exitT0 == null && ids.has(b.id))) return state
  const leaving = new Set(
    state.balls.filter((b) => b.exitT0 == null && ids.has(b.id)).map((b) => b.id),
  )
  return { ...state, balls: scheduleExits(state.balls, leaving, perfNow) }
}

/** 빠져나가는 공의 진행도(0~1, 선형) */
export const exitProgress = (b: PausedBall, perfNow: number): number => {
  if (b.exitT0 == null) return 0
  return Math.min(1, Math.max(0, (perfNow - b.exitT0) / EXIT_MS))
}

/**
 * 빠져나가는 공의 그리기 위치. 오가던 현재 x 에서 일정 속도로 오른쪽으로 가며, 트랙 아래쪽 차선(dy)으로 비켜
 * 내려가고 줄어들며 옅어져 멈춰 있는 공을 뚫고 지나가는 것처럼 보이지 않는다.
 */
export function exitPose(b: PausedBall, perfNow: number) {
  const t = exitProgress(b, perfNow)
  const elapsed = b.exitT0 == null ? 0 : Math.max(0, perfNow - b.exitT0)
  return {
    x: b.x + EXIT_SPEED * elapsed,
    dy: Math.min(1, t * 5) * PAUSED_R * EXIT_DRIFT,
    scale: 1 - 0.5 * t,
    // 처음 100ms 안에 절반 안팎으로 떨어져 옆의 살아있는 공을 가리지 않는다
    alpha: (1 - t) ** 2.5,
  }
}

/** 경고 -> 심각 색 전환 진행도(0~1). 전환 중이 아니면 1 */
export const recolorProgress = (b: PausedBall, perfNow: number): number =>
  Math.min(1, Math.max(0, (perfNow - b.changedAt) / RECOLOR_MS))

/** 글로우 맥동 배율(0.6~1). reduced 이면 맥동 없이 항상 1 */
export const pulseFactor = (perfNow: number, reduced: boolean): number =>
  reduced ? 1 : 0.8 + 0.2 * Math.sin((perfNow / PULSE_MS) * Math.PI * 2)

const parseRgb = (c: string): [number, number, number] | null => {
  const s = c.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1]
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** 두 CSS 색(hex/rgb)을 t(0~1)만큼 섞는다. 파싱 못 하면 t<1 이면 a, 아니면 b */
export function mixColor(a: string, b: string, t: number): string {
  const ca = parseRgb(a)
  const cb = parseRgb(b)
  if (!ca || !cb) return t < 1 ? a : b
  const m = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * t)
  return `rgb(${m(0)}, ${m(1)}, ${m(2)})`
}
