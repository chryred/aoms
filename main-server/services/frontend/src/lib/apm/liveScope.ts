import { instanceKey } from '@/lib/apm/liveData'
import type { LiveData } from '@/hooks/useApmLiveStream'
import type { AgentInstance } from '@/types/agent'

/** 좌측 호스트 목록에서 고른 범위. 모든 위젯이 이 범위를 따른다. */
export type Scope =
  | { kind: 'all' }
  | { kind: 'system'; systemId: number }
  | { kind: 'instance'; systemId: number; role: string }

export type InstanceStatus = 'live' | 'stale' | 'off'

export interface TreeInstance {
  key: string
  systemId: number
  role: string
  host: string | null
  /** 시리즈 색 CSS 변수 이름 */
  colorVar: string
  status: InstanceStatus
  /** 최근 agg 기준 JVM CPU(%) */
  cpu: number | null
  /** 최근 agg 기준 힙 사용률(%) = jvm.heap_used / jvm.heap_max */
  heapPct: number | null
  tps: number | null
}

export interface TreeSystem {
  systemId: number
  name: string
  instances: TreeInstance[]
}

export const SERIES_COUNT = 12
export const LIVE_WITHIN_MS = 15_000
export const STALE_WITHIN_MS = 120_000

export const seriesVar = (index: number) => `--t-series-${(index % SERIES_COUNT) + 1}`

/** agent_t 에이전트의 label_info.instance_role. 없으면 host 로 대체. */
export function agentRole(a: AgentInstance): string {
  try {
    const role = (JSON.parse(a.label_info ?? '{}') as { instance_role?: string }).instance_role
    if (role) return role
  } catch {
    // label_info 가 깨져 있어도 목록에서는 host 로 보여 준다
  }
  return a.host
}

function statusOf(lastTs: number | null, now: number): InstanceStatus {
  if (lastTs == null) return 'off'
  const age = now - lastTs
  if (age <= LIVE_WITHIN_MS) return 'live'
  return age <= STALE_WITHIN_MS ? 'stale' : 'off'
}

/** 등록된 agent_t 에이전트와 스트림에서 본 인스턴스를 합쳐 시스템별 호스트 트리를 만든다. */
export function buildHostTree(
  agents: AgentInstance[],
  systems: { id: number; display_name: string }[],
  events: Pick<LiveData, 'active' | 'agg'>,
  now: number,
): TreeSystem[] {
  const found = new Map<string, { systemId: number; role: string; host: string | null }>()
  for (const a of agents) {
    if (a.agent_type !== 'agent_t' || a.system_id == null) continue
    const role = agentRole(a)
    found.set(`${a.system_id}:${role}`, { systemId: a.system_id, role, host: a.host })
  }
  const seen = [
    ...events.active.values(),
    ...[...events.agg.values()].flatMap((l) => (l[0] ? [l[0]] : [])),
  ]
  for (const e of seen) {
    const k = instanceKey(e)
    if (!found.has(k)) found.set(k, { systemId: e.system_id, role: e.instance_role, host: null })
  }

  const sorted = [...found.entries()].sort(
    (a, b) => a[1].systemId - b[1].systemId || a[1].role.localeCompare(b[1].role),
  )
  const bySystem = new Map<number, TreeInstance[]>()
  sorted.forEach(([key, v], idx) => {
    const aggList = events.agg.get(key)
    const lastAgg = aggList?.[aggList.length - 1]
    const act = events.active.get(key)
    const ts = Math.max(lastAgg?.ts ?? -1, act?.ts ?? -1)
    const cpuRaw = lastAgg?.jvm?.cpu_ratio
    const heapUsed = lastAgg?.jvm?.heap_used
    const heapMax = lastAgg?.jvm?.heap_max
    const inst: TreeInstance = {
      key,
      systemId: v.systemId,
      role: v.role,
      host: v.host,
      colorVar: seriesVar(idx),
      status: statusOf(ts >= 0 ? ts : null, now),
      cpu: typeof cpuRaw === 'number' && Number.isFinite(cpuRaw) ? cpuRaw * 100 : null,
      heapPct:
        typeof heapUsed === 'number' && typeof heapMax === 'number' && heapMax > 0
          ? (heapUsed / heapMax) * 100
          : null,
      tps: lastAgg ? lastAgg.tps : null,
    }
    bySystem.set(v.systemId, [...(bySystem.get(v.systemId) ?? []), inst])
  })

  const order = new Map(systems.map((s, i) => [s.id, i]))
  return [...bySystem.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9) || a[0] - b[0])
    .map(([systemId, instances]) => ({
      systemId,
      name: systems.find((s) => s.id === systemId)?.display_name ?? `#${systemId}`,
      instances,
    }))
}

/** 시스템 그룹 행에 보이는 CPU / 힙 평균 (값이 있는 인스턴스만). 없으면 null. */
export function groupVitals(instances: TreeInstance[]): {
  cpu: number | null
  heap: number | null
} {
  const mean = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  return { cpu: mean(instances.map((i) => i.cpu)), heap: mean(instances.map((i) => i.heapPct)) }
}

export function instancesInScope(tree: TreeSystem[], scope: Scope): TreeInstance[] {
  return tree
    .flatMap((s) => s.instances)
    .filter((i) => {
      if (scope.kind === 'all') return true
      if (scope.kind === 'system') return i.systemId === scope.systemId
      return i.systemId === scope.systemId && i.role === scope.role
    })
}

export interface LiveSummary {
  active: number
  normal: number
  warning: number
  critical: number
  /** 초당 완료 트랜잭션 수(= 응답/초). 합계 */
  tps: number
  avgMs: number | null
  errRate: number | null
}

/** 범위 내 인스턴스(키 목록)의 현재값 요약. 최신 agg 한 건씩을 합산/평균한다. */
export function summarize(events: Pick<LiveData, 'active' | 'agg'>, keys: string[]): LiveSummary {
  const out: LiveSummary = {
    active: 0,
    normal: 0,
    warning: 0,
    critical: 0,
    tps: 0,
    avgMs: null,
    errRate: null,
  }
  let n = 0
  let ms = 0
  let er = 0
  for (const k of keys) {
    const act = events.active.get(k)
    if (act) {
      const [a = 0, w = 0, c = 0] = act.buckets
      out.normal += a
      out.warning += w
      out.critical += c
    }
    const list = events.agg.get(k)
    const last = list?.[list.length - 1]
    if (last) {
      out.tps += last.tps
      ms += last.avg_ms
      er += last.err_rate * 100
      n += 1
    }
  }
  out.active = out.normal + out.warning + out.critical
  if (n > 0) {
    out.avgMs = ms / n
    out.errRate = er / n
  }
  return out
}
