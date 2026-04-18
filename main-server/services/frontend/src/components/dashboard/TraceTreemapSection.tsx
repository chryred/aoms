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
  total: number
  errorCount: number
  errorRate: number
  p95Ms: number
  hasData: boolean
}

function severityClass(rate: number, hasData: boolean): string {
  if (!hasData) return 'bg-surface border-border text-text-disabled'
  if (rate >= 10) return 'bg-[rgba(239,68,68,0.18)] border-critical/50'
  if (rate >= 5) return 'bg-[rgba(245,158,11,0.16)] border-warning/40'
  if (rate >= 1) return 'bg-[rgba(245,158,11,0.08)] border-warning/25'
  return 'bg-[rgba(34,197,94,0.10)] border-normal/30'
}

function severityText(rate: number, hasData: boolean): string {
  if (!hasData) return 'text-text-disabled'
  if (rate >= 10) return 'text-critical'
  if (rate >= 5 || rate >= 1) return 'text-warning'
  return 'text-normal'
}

export function TraceTreemapSection({ systems }: TraceTreemapSectionProps) {
  const navigate = useNavigate()
  const otelSystems = systems.filter((s) => s.has_otel)

  const queries = useQueries({
    queries: otelSystems.map((s) => ({
      queryKey: ['traceMetrics', Number(s.system_id), 60],
      queryFn: () => tracesApi.getTraceMetrics(Number(s.system_id), 60),
      staleTime: 55_000,
      refetchInterval: 60_000,
    })),
  })

  if (otelSystems.length === 0) return null

  const tiles: TileData[] = otelSystems.map((s, i) => {
    const m = queries[i].data
    return {
      systemId: Number(s.system_id),
      name: s.display_name,
      total: m?.total ?? 0,
      errorCount: m?.error_count ?? 0,
      errorRate: m?.error_rate ?? 0,
      p95Ms: m?.p95_ms ?? 0,
      hasData: !!m && m.total > 0,
    }
  })

  // 에러율 높은 순 → 트래픽 많은 순
  tiles.sort((a, b) => b.errorRate - a.errorRate || b.total - a.total)

  return (
    <section className="space-y-3">
      <div>
        <h2 className="type-heading text-text-primary text-lg font-semibold">Trace ERROR 분석</h2>
        <p className="text-text-disabled mt-1 max-w-[60ch] text-xs leading-relaxed">
          OTel 등록 시스템의 최근 1시간 에러율 · 트래픽 — 타일 클릭 시 상세 페이지로 이동
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.systemId}
            onClick={() => navigate(ROUTES.systemDetail(t.systemId))}
            className={cn(
              'focus:ring-accent flex min-h-[104px] flex-col items-start justify-between rounded-sm border p-3 text-left transition-all hover:scale-[1.02] hover:shadow-md focus:ring-1 focus:outline-none',
              severityClass(t.errorRate, t.hasData),
            )}
          >
            <div className="flex w-full items-baseline justify-between gap-2">
              <span className="text-text-primary min-w-0 flex-1 truncate text-sm font-semibold">
                {t.name}
              </span>
              {t.hasData && t.errorRate >= 1 && (
                <span className="text-critical text-[10px] font-semibold tabular-nums">
                  ⚠ 에러
                </span>
              )}
            </div>
            <div className="mt-2 flex w-full items-baseline justify-between gap-2">
              <span
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  severityText(t.errorRate, t.hasData),
                )}
              >
                {t.hasData ? `${t.errorRate.toFixed(1)}%` : '—'}
              </span>
              <span className="text-text-secondary text-[10px] tabular-nums">
                {t.hasData ? 'error rate' : '데이터 없음'}
              </span>
            </div>
            <div className="mt-1 flex w-full items-center justify-between gap-2 text-[11px]">
              <span className="text-text-secondary tabular-nums">
                {t.total.toLocaleString()}건
              </span>
              <span className="text-text-secondary tabular-nums">
                p95 {t.p95Ms.toFixed(0)}ms
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
