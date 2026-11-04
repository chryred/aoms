import type { AgentInstance } from '@/types/agent'
import type { DashboardWidget, LiveActiveEvent, LiveAggEvent, LivePoolStat } from '@/types/apm'

/** 위젯이 바라보는 대상. systemIds 가 비어 있으면 모든 시스템. */
export interface WidgetTarget {
  systemIds: number[]
  instanceRole?: string
  /** 지정되면 이 인스턴스 키(`systemId:role`)만 대상 (칩 바 토글 결과) */
  instanceKeys?: string[]
}

export const instanceKey = (e: { system_id: number; instance_role: string }) =>
  `${e.system_id}:${e.instance_role}`

export function matchesTarget(e: { system_id: number; instance_role: string }, t: WidgetTarget) {
  if (t.systemIds.length > 0 && !t.systemIds.includes(e.system_id)) return false
  if (t.instanceKeys && !t.instanceKeys.includes(instanceKey(e))) return false
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

/** 최근 5분 고유 사용자 수(gateway 계산). 구 gateway 는 필드가 없어 null. */
export function usersNum(e: LiveAggEvent): number | null {
  return typeof e.users_5m === 'number' && Number.isFinite(e.users_5m) ? e.users_5m : null
}

/**
 * DB 커넥션 "사용 중" 값. 쿼리가 커넥션을 수 ms 만 잡아 5초 시점 값(conn_active)은 거의 0 이므로
 * 에이전트가 보내는 5초 창 최대값(conn_peak)을 우선하고, 구 에이전트면 conn_active 로 되돌아간다.
 */
export function connUsedNum(e: LiveAggEvent): number | null {
  return jvmNum(e, 'conn_peak') ?? jvmNum(e, 'conn_active')
}

/** 대상 중 conn_peak 를 보내는 에이전트가 하나라도 있으면 true. */
export function hasConnPeak(lists: LiveAggEvent[][]): boolean {
  return lists.some((l) => l.some((e) => jvmNum(e, 'conn_peak') != null))
}

/** jvm.pools 를 안전하게 읽는다(구 에이전트·잘못된 항목은 건너뜀). */
export function jvmPools(e: LiveAggEvent): LivePoolStat[] {
  const raw = e.jvm?.pools
  if (!Array.isArray(raw)) return []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const out: LivePoolStat[] = []
  for (const p of raw as Record<string, unknown>[]) {
    if (!p || typeof p.name !== 'string' || p.name === '') continue
    const peak = typeof p.peak === 'number' && Number.isFinite(p.peak) ? p.peak : undefined
    out.push({
      ...(peak !== undefined ? { peak } : {}),
      name: p.name,
      kind: typeof p.kind === 'string' ? p.kind : '',
      active: num(p.active),
      idle: num(p.idle),
      max: num(p.max),
      wait: num(p.wait),
    })
  }
  return out
}

export interface PoolRow extends LivePoolStat {
  /** 소속 인스턴스 키(`systemId:role`) */
  instance: string
  /** 사용률 = max(active, peak)/max (max 미상이면 0). 막대·정렬·상태색이 이 값을 따른다 */
  util: number
}

export type PoolLevel = 'normal' | 'warning' | 'critical'

/** 사용 중으로 볼 값: 5초 창 최대(peak)가 있으면 max(active, peak). */
export function poolUsed(p: { active: number; peak?: number }): number {
  return Math.max(p.active, p.peak ?? 0)
}

/** 사용률 100% 이상 또는 대기 스레드가 있으면 critical, 80% 이상 warning. peak 가 있으면 peak 기준. */
export function poolLevel(p: {
  active: number
  peak?: number
  max: number
  wait: number
}): PoolLevel {
  const util = p.max > 0 ? poolUsed(p) / p.max : 0
  if (p.wait > 0 || util >= 1) return 'critical'
  if (util >= 0.8) return 'warning'
  return 'normal'
}

/** 풀 값이 없는 5초 창(jvm 이 5초마다만 오므로)을 건너뛰기 위해 되짚는 최대 이벤트 수 */
const POOL_LOOKBACK = 3

/** 인스턴스별 가장 최근 풀 목록을 사용률 내림차순(동률은 대기 많은 순, 이름순)으로. */
export function latestPoolRows(lists: LiveAggEvent[][]): PoolRow[] {
  const rows: PoolRow[] = []
  for (const list of lists) {
    for (let i = list.length - 1; i >= Math.max(0, list.length - POOL_LOOKBACK); i--) {
      const pools = jvmPools(list[i])
      if (pools.length === 0) continue
      const instance = instanceKey(list[i])
      for (const p of pools) {
        rows.push({ ...p, instance, util: p.max > 0 ? poolUsed(p) / p.max : 0 })
      }
      break
    }
  }
  return rows.sort((a, b) => b.util - a.util || b.wait - a.wait || a.name.localeCompare(b.name))
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
