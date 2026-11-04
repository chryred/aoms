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

export interface QueueSeg {
  level: QueueLevel
  y: number
  h: number
}
export interface QueueRect {
  key: string
  x: number
  w: number
  segs: QueueSeg[]
}

const LEVELS: QueueLevel[] = ['normal', 'warning', 'critical']

/** 막대 사각형 계산 (아래 기준 누적). labelH 는 하단 라벨 영역 높이. */
export function queueGeometry(
  bars: QueueBar[],
  width: number,
  height: number,
  labelH = 18,
): QueueRect[] {
  if (bars.length === 0) return []
  const maxTotal = Math.max(1, ...bars.map((b) => b.total))
  const slot = width / bars.length
  const barW = Math.min(48, slot * 0.7)
  const plotH = Math.max(0, height - labelH)
  return bars.map((b, i) => {
    let y = plotH
    const segs: QueueSeg[] = []
    b.buckets.forEach((n, li) => {
      const h = (n / maxTotal) * plotH
      if (h > 0) {
        y -= h
        segs.push({ level: LEVELS[li], y, h })
      }
    })
    return { key: b.key, x: slot * i + (slot - barW) / 2, w: barW, segs }
  })
}

/** 클릭 x 좌표가 속한 막대 key (슬롯 기준이라 막대 옆 빈 곳도 인식). */
export function hitBar(bars: QueueBar[], width: number, px: number): string | null {
  if (bars.length === 0 || px < 0 || px > width) return null
  const idx = Math.min(bars.length - 1, Math.floor(px / (width / bars.length)))
  return bars[idx].key
}
