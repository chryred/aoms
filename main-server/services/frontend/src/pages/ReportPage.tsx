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
  const dailyResult = useDailyAggregations({ system_id: systemFilter })
  const weeklyResult = useWeeklyAggregations({ system_id: systemFilter })
  const monthlyResult = useMonthlyAggregations({
    system_id: systemFilter,
    period_type: isMonthly ? (period as PeriodType) : undefined,
  })

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

  let aggData: (DailyAggregation | WeeklyAggregation | MonthlyAggregation)[] = []
  let isLoading = false

  if (period === 'daily') {
    aggData = dailyResult.data ?? []
    isLoading = dailyResult.isLoading
  } else if (period === 'weekly') {
    aggData = weeklyResult.data ?? []
    isLoading = weeklyResult.isLoading
  } else {
    aggData = monthlyResult.data ?? []
    isLoading = monthlyResult.isLoading
  }

  // 시스템별 그룹핑 (가장 최근 1개만 대표로 사용)
  const bySystem = aggData.reduce<Record<number, (typeof aggData)[0]>>((acc, agg) => {
    if (!acc[agg.system_id]) acc[agg.system_id] = agg
    return acc
  }, {})

  return (
    <div>
      <PageHeader title="안정성 리포트" />

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <PeriodToggle value={period} onChange={onPeriodChange} />
        <div className="w-48">
          <NeuSelect value={systemFilter?.toString() ?? ''} onChange={onSystemChange}>
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
        <div className="text-text-secondary text-sm">불러오는 중...</div>
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
