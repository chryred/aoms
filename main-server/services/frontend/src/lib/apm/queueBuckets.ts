import type { LiveActiveEvent } from '@/types/apm'
import { instanceKey } from '@/lib/apm/liveData'

export type QueueLevel = 'normal' | 'warning' | 'critical'

/** 정상 < T, 경고 T ~ 3T, 위험 >= 3T (T = 느린 기준). */
export function queueColor(elapsedMs: number, slowMs: number): QueueLevel {
  if (elapsedMs >= slowMs * 3) return 'critical'
  if (elapsedMs >= slowMs) return 'warning'
  return 'normal'
}

export interface QueueBar {
  key: string
  system_id: number
  instance_role: string
  /** [정상, 경고, 위험] */
  buckets: [number, number, number]
  total: number
}

export function queueBars(events: LiveActiveEvent[]): QueueBar[] {
  return events
    .map((e) => {
      const [n = 0, w = 0, c = 0] = e.buckets
      return {
        key: instanceKey(e),
        system_id: e.system_id,
        instance_role: e.instance_role,
        buckets: [n, w, c] as [number, number, number],
        total: n + w + c,
      }
    })
    .sort((a, b) => a.system_id - b.system_id || a.instance_role.localeCompare(b.instance_role))
}

/**
 * 범위 안(keys = `systemId:role`)인데 아직 active 이벤트가 없는 인스턴스에 0건 막대를 채운다.
 * 수신 전 인스턴스도 막대와 라벨이 보여 "비어 보이는" 위젯이 되지 않는다.
 */
export function withZeroBars(bars: QueueBar[], keys: string[] | undefined): QueueBar[] {
  if (!keys || keys.length === 0) return bars
  const have = new Set(bars.map((b) => b.key))
  const zeros: QueueBar[] = keys
    .filter((k) => !have.has(k))
    .flatMap((key) => {
      const cut = key.indexOf(':')
      const system_id = Number(key.slice(0, cut))
      if (cut < 0 || !Number.isFinite(system_id)) return []
      return [
        {
          key,
          system_id,
          instance_role: key.slice(cut + 1),
          buckets: [0, 0, 0] as [number, number, number],
          total: 0,
        },
      ]
    })
  return [...bars, ...zeros].sort(
    (a, b) => a.system_id - b.system_id || a.instance_role.localeCompare(b.instance_role),
  )
}

const LEVELS: QueueLevel[] = ['normal', 'warning', 'critical']

export interface QueueBlock {
  level: QueueLevel
  y: number
}
export interface QueueTower {
  key: string
  /** 탑 중심 x */
  cx: number
  /** 블록 폭·높이 */
  w: number
  h: number
  /** 그려질 블록(아래→위). 위험이 맨 아래, 정상이 맨 위 */
  blocks: QueueBlock[]
  /** 칸 수 제한으로 못 그린 건수 (0 이면 "+N" 라벨 없음). 라벨 자리는 블록 위 1칸 */
  overflow: number
  /** 맨 위 요소(블록 또는 "+N" 라벨 칸)의 y — 건수 라벨을 이 위에 둔다 */
  topY: number
  /** 맨 아래 칸의 y (0건 자리표시 슬롯 위치) */
  baseY: number
  /** 슬롯 x 범위 (hover·클릭 영역) */
  slotX: number
  slotW: number
}

export const BLOCK_MIN = 4
export const BLOCK_MAX = 12
export const BLOCK_GAP = 2

/**
 * 블록 탑 기하 (호스트당 한 칼럼, 트랜잭션 1건 = 블록 1개, 아래→위 누적).
 * 위험을 맨 아래에 둔다: 칸이 모자라 잘릴 때 위쪽(정상)부터 줄어 위험·경고 블록은 항상 보이고,
 * 심각 건이 바닥 기준선에 붙어 가장 눈에 띈다. 블록 크기는 가장 높은 탑이 들어가는 가장 큰 값(4~12px)이며
 * 폭도 슬롯 폭에 맞춰 줄어든다. plotH 는 하단 라벨을 뺀 탑 영역 높이.
 */
export function queueTowers(bars: QueueBar[], width: number, plotH: number): QueueTower[] {
  if (bars.length === 0) return []
  const slot = width / bars.length
  const maxTotal = Math.max(1, ...bars.map((b) => b.total))
  const rowsFor = (s: number) => Math.max(1, Math.floor((plotH + BLOCK_GAP) / (s + BLOCK_GAP)))
  const cap = Math.min(BLOCK_MAX, Math.max(BLOCK_MIN, Math.floor(slot * 0.8)))
  let size = BLOCK_MIN
  for (let s = cap; s >= BLOCK_MIN; s--) {
    if (rowsFor(s) >= maxTotal) {
      size = s
      break
    }
  }
  const rows = rowsFor(size)
  const w = Math.max(2, Math.min(size * 2, slot * 0.8))
  const order: QueueLevel[] = ['critical', 'warning', 'normal']
  return bars.map((b, i) => {
    const over = b.total > rows
    const drawable = over ? Math.max(0, rows - 1) : b.total
    const levels: QueueLevel[] = []
    for (const lv of order) {
      const n = b.buckets[LEVELS.indexOf(lv)]
      for (let k = 0; k < n && levels.length < drawable; k++) levels.push(lv)
    }
    const baseY = plotH - size
    const blocks = levels.map((level, r) => ({ level, y: baseY - r * (size + BLOCK_GAP) }))
    const slots = levels.length + (over ? 1 : 0)
    const topY = baseY - Math.max(0, slots - 1) * (size + BLOCK_GAP)
    return {
      key: b.key,
      cx: slot * i + slot / 2,
      w,
      h: size,
      blocks,
      overflow: over ? b.total - levels.length : 0,
      topY,
      baseY,
      slotX: slot * i,
      slotW: slot,
    }
  })
}

/** 산점도 점 등급. 그리기 순서는 normal < warning < critical < error. */
export type ScatterLevel = QueueLevel | 'error'
export const SCATTER_ORDER: ScatterLevel[] = ['normal', 'warning', 'critical', 'error']

export function scatterLevel(elapsedMs: number, error: boolean, slowMs: number): ScatterLevel {
  return error ? 'error' : queueColor(elapsedMs, slowMs)
}

/** 범례용 초 표기 (1000→"1s", 1500→"1.5s"). */
export function formatSec(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))}s`
}

/** 클릭 x 좌표가 속한 막대 key (슬롯 기준이라 막대 옆 빈 곳도 인식). */
export function hitBar(bars: QueueBar[], width: number, px: number): string | null {
  if (bars.length === 0 || px < 0 || px > width) return null
  const idx = Math.min(bars.length - 1, Math.floor(px / (width / bars.length)))
  return bars[idx].key
}
