import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3 } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { EmptyState } from '@/components/common/EmptyState'
import { PeriodToggle } from '@/components/reports/PeriodToggle'
import { AggregationCard } from '@/components/reports/AggregationCard'
import { useSystems } from '@/hooks/queries/useSystems'
import {
  useDailyAggregations,
  useWeeklyAggregations,
  useMonthlyAggregations,
} from '@/hooks/queries/useAggregations'
import type { ReportType } from '@/types/report'
import type {
  DailyAggregation,
  WeeklyAggregation,
  MonthlyAggregation,
  PeriodType,
} from '@/types/aggregation'

export function ReportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const period = (searchParams.get('period') ?? 'daily') as ReportType
  const systemFilterStr = searchParams.get('system_id')
  const systemFilter = systemFilterStr ? Number(systemFilterStr) : undefined

  const { data: systems = [] } = useSystems()

  const isMonthly = ['monthly', 'quarterly', 'half_year', 'annual'].includes(period)
  const dailyResult = useDailyAggregations({ system_id: systemFilter }, period === 'daily')
  const weeklyResult = useWeeklyAggregations({ system_id: systemFilter }, period === 'weekly')
  const monthlyResult = useMonthlyAggregations(
    { system_id: systemFilter, period_type: isMonthly ? (period as PeriodType) : undefined },
    isMonthly,
  )

  function onPeriodChange(p: ReportType) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('period', p)
      return next
    })
  }

  function onSystemChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (val) next.set('system_id', val)
      else next.delete('system_id')
      return next
    })
  }

  const aggData = useMemo<(DailyAggregation | WeeklyAggregation | MonthlyAggregation)[]>(() => {
    if (period === 'daily') return dailyResult.data ?? []
    if (period === 'weekly') return weeklyResult.data ?? []
    return monthlyResult.data ?? []
  }, [period, dailyResult.data, weeklyResult.data, monthlyResult.data])

  const isLoading =
    period === 'daily'
      ? dailyResult.isLoading
      : period === 'weekly'
        ? weeklyResult.isLoading
        : monthlyResult.isLoading

  // 시스템별 그룹핑 (가장 최근 1개만 대표로 사용)
  const bySystem = useMemo(
    () =>
      aggData.reduce<Record<number, (typeof aggData)[0]>>((acc, agg) => {
        if (!acc[agg.system_id]) acc[agg.system_id] = agg
        return acc
      }, {}),
    [aggData],
  )

  return (
    <div>
      <PageHeader title="안정성 리포트" />

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <PeriodToggle value={period} onChange={onPeriodChange} />
        <div className="w-full max-w-48">
          <NeuSelect
            value={systemFilter?.toString() ?? ''}
            onChange={onSystemChange}
            aria-label="시스템 필터"
          >
            <option value="">전체 시스템</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </NeuSelect>
        </div>
      </div>

      {isLoading ? (
        <div
          role="status"
          aria-live="polite"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <span className="sr-only">불러오는 중...</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-bg-base shadow-neu-flat animate-pulse rounded-sm p-6">
              <div className="mb-4 flex items-start justify-between">
                <div className="space-y-2">
                  <div className="bg-border h-4 w-32 rounded-sm" />
                  <div className="bg-border/60 h-3 w-20 rounded-sm" />
                </div>
                <div className="bg-border/60 h-5 w-10 rounded-full" />
              </div>
              <div className="mb-3 flex gap-4">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="space-y-1">
                    <div className="bg-border/50 h-2.5 w-12 rounded-sm" />
                    <div className="bg-border/70 h-3 w-10 rounded-sm" />
                  </div>
                ))}
              </div>
              <div className="mb-3 space-y-2">
                <div className="bg-border/50 h-3 w-full rounded-sm" />
                <div className="bg-border/50 h-3 w-full rounded-sm" />
                <div className="bg-border/50 h-3 w-3/4 rounded-sm" />
              </div>
              <div className="bg-border/40 mb-4 h-3 w-1/2 rounded-sm" />
              <div className="bg-border/60 h-3 w-16 rounded-sm" />
            </div>
          ))}
        </div>
      ) : Object.keys(bySystem).length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" />}
          title="집계 데이터가 없습니다"
          description="n8n WF7-WF10 워크플로우가 실행되면 자동으로 채워집니다."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(bySystem).map(([sysId, agg]) => {
            const sys = systems.find((s) => s.id === Number(sysId))
            return (
              <AggregationCard
                key={sysId}
                systemId={Number(sysId)}
                systemName={sys?.system_name ?? `system-${sysId}`}
                displayName={sys?.display_name ?? `System ${sysId}`}
                aggregation={agg}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
