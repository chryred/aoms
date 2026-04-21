import { useNavigate } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { tracesApi } from '@/api/traces'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'
import type { SystemHealthData } from '@/hooks/queries/useDashboardHealth'

interface TraceTreemapSectionProps {
  systems: SystemHealthData[]
}

interface TileData {
  systemId: number
  name: string
  errorCount: number
  slowCount: number
  anomalyCount: number
  sampledTotal: number
  p95Ms: number
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
  const otelSystems = systems.filter((s) => s.has_otel)

  const queries = useQueries({
    queries: otelSystems.map((s) => ({
      queryKey: ['traceMetrics', Number(s.system_id), 360],
      queryFn: () => tracesApi.getTraceMetrics(Number(s.system_id), 360),
      staleTime: 55_000,
      refetchInterval: 60_000,
    })),
  })

  if (otelSystems.length === 0) return null

  const tiles: TileData[] = otelSystems.map((s, i) => {
    const m = queries[i].data
    const errorCount = m?.error_count ?? 0
    const slowCount = m?.slow_count ?? 0
    const anomalyCount = m?.anomaly_count ?? errorCount + slowCount
    const sampledTotal = m?.total ?? 0
    return {
      systemId: Number(s.system_id),
      name: s.display_name,
      errorCount,
      slowCount,
      anomalyCount,
      sampledTotal,
      p95Ms: m?.p95_ms ?? 0,
      hasData: !!m && (anomalyCount > 0 || sampledTotal > 0),
    }
  })

  // 이상 건수 많은 순 → sampled 트래픽 많은 순
  tiles.sort((a, b) => b.anomalyCount - a.anomalyCount || b.sampledTotal - a.sampledTotal)

  return (
    <section className="space-y-3">
      <div>
        <h2 className="type-heading text-text-primary text-lg font-semibold">Trace 분석</h2>
        <p className="text-text-disabled mt-1 max-w-[60ch] text-xs leading-relaxed">
          OTel 등록 시스템의 최근 6시간 에러·느린 요청 건수 — 타일 클릭 시 상세 페이지로 이동
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const sev = severity(t.anomalyCount, t.hasData)
          const badge = severityLabel(sev)
          return (
            <button
              key={t.systemId}
              onClick={() => navigate(ROUTES.systemDetail(t.systemId))}
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
                  {t.hasData ? `${t.anomalyCount.toLocaleString()}건` : '—'}
                </span>
                <span className="text-text-secondary text-[10px] tabular-nums">
                  {t.hasData ? '이상 요청' : '데이터 없음'}
                </span>
              </div>
              <div className="mt-1 flex w-full items-center justify-between gap-2 text-[11px]">
                <span className="text-text-secondary tabular-nums">
                  에러 {t.errorCount.toLocaleString()} · 느린 {t.slowCount.toLocaleString()}
                </span>
                <span className="text-text-secondary tabular-nums">p95 {t.p95Ms.toFixed(0)}ms</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
