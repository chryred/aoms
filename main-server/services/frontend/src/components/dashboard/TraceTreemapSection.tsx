import { useNavigate } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { apmApi } from '@/api/apm'
import { qk } from '@/constants/queryKeys'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'
import type { SystemHealthData } from '@/hooks/queries/useDashboardHealth'

interface TraceTreemapSectionProps {
  systems: SystemHealthData[]
}

interface TileData {
  systemId: number
  name: string
  slowCount: number
  tps: number
  avgMs: number
  slowThresholdMs: number
  hasData: boolean
}

const SEVERITY_WARN = 50
const SEVERITY_CRIT = 100

type Severity = 'none' | 'normal' | 'warn' | 'crit'

function severity(count: number, hasData: boolean): Severity {
  if (!hasData) return 'none'
  if (count >= SEVERITY_CRIT) return 'crit'
  if (count >= SEVERITY_WARN) return 'warn'
  return 'normal'
}

function severityClass(s: Severity): string {
  switch (s) {
    case 'none':
      return 'bg-surface border-border text-text-disabled'
    case 'crit':
      return 'bg-[rgba(239,68,68,0.18)] border-critical/50'
    case 'warn':
      return 'bg-[rgba(245,158,11,0.16)] border-warning/40'
    default:
      return 'bg-[rgba(34,197,94,0.10)] border-normal/30'
  }
}

function severityTextClass(s: Severity): string {
  switch (s) {
    case 'none':
      return 'text-text-disabled'
    case 'crit':
      return 'text-critical'
    case 'warn':
      return 'text-warning'
    default:
      return 'text-normal'
  }
}

function severityLabel(s: Severity): string | null {
  if (s === 'crit') return '⚠ 위험'
  if (s === 'warn') return '⚠ 경고'
  return null
}

export function TraceTreemapSection({ systems }: TraceTreemapSectionProps) {
  const navigate = useNavigate()
  const agentTSystems = systems.filter((s) => s.has_agent_t)

  const queries = useQueries({
    queries: agentTSystems.map((s) => ({
      queryKey: qk.apm.systemSummary(Number(s.system_id)),
      queryFn: () => apmApi.getSystemSummary(Number(s.system_id)),
      staleTime: 55_000,
      refetchInterval: 60_000,
    })),
  })

  if (agentTSystems.length === 0) return null

  const tiles: TileData[] = agentTSystems.map((s, i) => {
    const m = queries[i].data
    return {
      systemId: Number(s.system_id),
      name: s.display_name,
      slowCount: m?.slow_count_1h ?? 0,
      tps: m?.tps_1h ?? 0,
      avgMs: m?.avg_ms_1h ?? 0,
      slowThresholdMs: m?.slow_threshold_ms ?? 0,
      hasData: !!m && (m.slow_count_1h > 0 || m.tps_1h > 0),
    }
  })

  // 느린 건수 많은 순 → TPS 높은 순
  tiles.sort((a, b) => b.slowCount - a.slowCount || b.tps - a.tps)

  return (
    <section className="space-y-3">
      <div>
        <h2 className="type-heading text-text-primary text-lg font-semibold">트랜잭션 분석</h2>
        <p className="text-text-disabled mt-1 max-w-[60ch] text-xs leading-relaxed">
          Agent-T 설치 시스템의 최근 1시간 느린 트랜잭션 건수 — 타일 클릭 시 실시간 모니터링으로
          이동
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const sev = severity(t.slowCount, t.hasData)
          const badge = severityLabel(sev)
          return (
            <button
              key={t.systemId}
              onClick={() => navigate(`${ROUTES.APM_LIVE}?system=${t.systemId}`)}
              className={cn(
                'focus:ring-accent flex min-h-[104px] flex-col items-start justify-between rounded-sm border p-3 text-left transition-all hover:scale-[1.02] hover:shadow-md focus:ring-1 focus:outline-none',
                severityClass(sev),
              )}
            >
              <div className="flex w-full items-baseline justify-between gap-2">
                <span className="text-text-primary min-w-0 flex-1 truncate text-sm font-semibold">
                  {t.name}
                </span>
                {badge && (
                  <span
                    className={cn('text-[10px] font-semibold tabular-nums', severityTextClass(sev))}
                  >
                    {badge}
                  </span>
                )}
              </div>
              <div className="mt-2 flex w-full items-baseline justify-between gap-2">
                <span className={cn('text-2xl font-bold tabular-nums', severityTextClass(sev))}>
                  {t.hasData ? `${t.slowCount.toLocaleString()}건` : '—'}
                </span>
                <span className="text-text-secondary text-[10px] tabular-nums">
                  {t.hasData ? '느린 트랜잭션' : '데이터 없음'}
                </span>
              </div>
              <div className="mt-1 flex w-full items-center justify-between gap-2 text-[11px]">
                <span className="text-text-secondary tabular-nums">TPS {t.tps.toFixed(1)}</span>
                <span className="text-text-secondary tabular-nums">
                  평균 {Math.round(t.avgMs)}ms
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
