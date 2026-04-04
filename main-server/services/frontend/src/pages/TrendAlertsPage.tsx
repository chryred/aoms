import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShieldCheck, Filter, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { CriticalTrendBanner } from '@/components/trends/CriticalTrendBanner'
import { TrendAlertCard } from '@/components/trends/TrendAlertCard'
import { useTrendAlerts } from '@/hooks/queries/useTrendAlerts'
import { useUiStore } from '@/store/uiStore'
import { formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { LlmSeverity } from '@/types/aggregation'

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
]

export default function TrendAlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const severityFilter = searchParams.get('severity') ?? 'all'

  const { data: trendAlerts = [], isLoading, isError, refetch, dataUpdatedAt } =
    useTrendAlerts()

  const criticalCount = useUiStore((s) => s.criticalCount)

  const filtered = useMemo(() => {
    if (severityFilter === 'all') return trendAlerts
    return trendAlerts.filter((a) => a.llm_severity === (severityFilter as LlmSeverity))
  }, [trendAlerts, severityFilter])

  return (
    <div>
      <PageHeader
        title="트렌드 예측 알림"
        description="LLM 분석 기반 프로액티브 장애 예방 알림"
        action={
          <div className="flex items-center gap-2 text-sm text-[#4A5568]">
            <RefreshCw className="w-4 h-4" />
            <span>5분 자동 갱신</span>
            {dataUpdatedAt > 0 && (
              <span className="text-xs">
                마지막 갱신: {formatRelative(new Date(dataUpdatedAt).toISOString())}
              </span>
            )}
          </div>
        }
      />

      <CriticalTrendBanner count={criticalCount} />

      {/* Severity filter bar */}
      <div className="flex gap-2 mb-6" role="group" aria-label="심각도 필터">
        {SEVERITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setSearchParams({ severity: opt.value })}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium transition-all',
              'focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2',
              severityFilter === opt.value
                ? 'bg-[#6366F1] text-white shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF]'
                : 'bg-[#E8EBF0] text-[#4A5568] shadow-[3px_3px_6px_#C8CBD4,-3px_-3px_6px_#FFFFFF] hover:bg-[rgba(99,102,241,0.1)]'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading && <LoadingSkeleton shape="card" count={5} />}

      {isError && <ErrorCard onRetry={refetch} />}

      {!isLoading && !isError && trendAlerts.length === 0 && (
        <EmptyState
          icon={<ShieldCheck className="w-12 h-12 text-[#22C55E]" />}
          title="현재 임박한 장애 예측이 없습니다"
          description="모든 시스템이 정상 범위에서 운영되고 있습니다."
        />
      )}

      {!isLoading && !isError && trendAlerts.length > 0 && filtered.length === 0 && (
        <EmptyState
          icon={<Filter className="w-12 h-12 text-[#4A5568]" />}
          title={`${severityFilter === 'warning' ? 'Warning' : 'Critical'} 수준의 예측 알림이 없습니다`}
          description="다른 심각도를 선택하거나 '전체'를 선택해보세요."
          cta={{ label: '전체 보기', onClick: () => setSearchParams({ severity: 'all' }) }}
        />
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="flex flex-col gap-4">
          {filtered.map((alert) => (
            <TrendAlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  )
}
