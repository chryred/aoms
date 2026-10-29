import type { AgentInstance } from '@/types/agent'
import type { DashboardWidget, LiveActiveEvent, LiveAggEvent } from '@/types/apm'

/** 위젯이 바라보는 대상. systemIds 가 비어 있으면 모든 시스템. */
export interface WidgetTarget {
  systemIds: number[]
  instanceRole?: string
}

export const instanceKey = (e: { system_id: number; instance_role: string }) =>
  `${e.system_id}:${e.instance_role}`

export function matchesTarget(e: { system_id: number; instance_role: string }, t: WidgetTarget) {
  if (t.systemIds.length > 0 && !t.systemIds.includes(e.system_id)) return false
  return !t.instanceRole || e.instance_role === t.instanceRole
}

export function pickActive(map: Map<string, LiveActiveEvent>, t: WidgetTarget): LiveActiveEvent[] {
  return [...map.values()].filter((e) => matchesTarget(e, t))
}

/** 대상 인스턴스별 agg 이벤트 배열(오래된 순). */
export function pickAgg(map: Map<string, LiveAggEvent[]>, t: WidgetTarget): LiveAggEvent[][] {
  return [...map.values()].filter((list) => list.length > 0 && matchesTarget(list[0], t))
}

export interface SeriesPoint {
  ts: number
  value: number
}

const SERIES_STEP_MS = 5_000

/** 여러 인스턴스의 agg 값을 5초 버킷으로 합치거나(sum) 평균(mean) 낸 시계열. pick 이 null 이면 건너뛴다. */
export function mergeSeries(
  lists: LiveAggEvent[][],
  pick: (e: LiveAggEvent) => number | null,
  mode: 'sum' | 'mean',
): SeriesPoint[] {
  const buckets = new Map<number, { sum: number; n: number }>()
  for (const list of lists) {
    for (const e of list) {
      const v = pick(e)
      if (v == null || !Number.isFinite(v)) continue
      const t = Math.round(e.ts / SERIES_STEP_MS) * SERIES_STEP_MS
      const b = buckets.get(t) ?? { sum: 0, n: 0 }
      b.sum += v
      b.n += 1
      buckets.set(t, b)
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, b]) => ({ ts, value: mode === 'sum' ? b.sum : b.sum / b.n }))
}

/** jvm 객체에서 숫자 필드를 안전하게 읽는다. */
export function jvmNum(e: LiveAggEvent, key: string): number | null {
  const v = e.jvm?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 최근 agg 의 dropped 합이 0 보다 큰 인스턴스 키. */
export function droppedKeys(map: Map<string, LiveAggEvent[]>): string[] {
  const out: string[] = []
  for (const [k, list] of map) {
    const last = list[list.length - 1]
    if (last && last.dropped.detail + last.dropped.sql + last.dropped.tx > 0) out.push(k)
  }
  return out
}

/** URI/SQL 상위: 여러 agg 이벤트를 키별로 합산해 누적 시간 순으로. */
export function mergeTop<T extends { cnt: number; ms: number }>(
  lists: LiveAggEvent[][],
  pick: (e: LiveAggEvent) => T[],
  keyOf: (item: T) => string,
  limit = 10,
): { key: string; cnt: number; ms: number }[] {
  const acc = new Map<string, { key: string; cnt: number; ms: number }>()
  for (const list of lists) {
    for (const e of list) {
      for (const it of pick(e)) {
        const k = keyOf(it)
        const cur = acc.get(k) ?? { key: k, cnt: 0, ms: 0 }
        cur.cnt += it.cnt
        cur.ms += it.ms
        acc.set(k, cur)
      }
    }
  }
  return [...acc.values()].sort((a, b) => b.ms - a.ms).slice(0, limit)
}

/** 위젯의 x,y,w,h 를 그리드 레이아웃 결과로 덮어쓴다. */
export function applyLayout(
  widgets: DashboardWidget[],
  layout: readonly { i: string; x: number; y: number; w: number; h: number }[],
): DashboardWidget[] {
  return widgets.map((w) => {
    const l = layout.find((it) => it.i === w.i)
    return l ? { ...w, x: l.x, y: l.y, w: l.w, h: l.h } : w
  })
}

/** label_info 의 instance_role 이 일치하는 에이전트 id. 에이전트가 하나뿐이면 그것을 사용. */
export function findAgentId(agents: AgentInstance[], role: string): number | null {
  const byRole = agents.find((a) => {
    try {
      return (JSON.parse(a.label_info ?? '{}') as { instance_role?: string }).instance_role === role
    } catch {
      return false
    }
  })
  if (byRole) return byRole.id
  return agents.length === 1 ? agents[0].id : null
}
