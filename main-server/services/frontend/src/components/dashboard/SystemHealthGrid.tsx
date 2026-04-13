import { memo, useState, useMemo } from 'react'
import { EnhancedSystemCard } from './EnhancedSystemCard'
import { EmptyState } from '@/components/common/EmptyState'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHourlyAggregations } from '@/hooks/queries/useAggregations'
import type { SystemHealthData } from '@/hooks/queries/useDashboardHealth'

type SortKey = 'status' | 'name'
type FilterStatus = 'all' | 'critical' | 'warning' | 'normal'

const FILTER_LABELS: Record<FilterStatus, string> = {
  all: '전체',
  critical: '위험',
  warning: '경고',
  normal: '정상',
}

const SORT_LABELS: Record<SortKey, string> = {
  status: '상태순',
  name: '이름순',
}

interface SystemHealthGridProps {
  systems: SystemHealthData[]
  onAddSystem?: () => void
}

export const SystemHealthGrid = memo(function SystemHealthGrid({
  systems,
  onAddSystem,
}: SystemHealthGridProps) {
  const [sortBy, setSortBy] = useState<SortKey>('status')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')

  // 스파크라인 데이터 bulk fetch (24h CPU, 전체 시스템)
  const { fromDt } = useMemo(() => {
    const from = new Date(Date.now() - 24 * 3_600_000)
    return { fromDt: from.toISOString() }
  }, [])

  const { data: hourlyData } = useHourlyAggregations({
    collector_type: 'synapse_agent',
    metric_group: 'cpu',
    from_dt: fromDt,
  })

  // system_id → sparkline data 변환
  const sparkDataMap = useMemo(() => {
    if (!hourlyData || hourlyData.length === 0) return {}
    const map: Record<number, { v: number }[]> = {}
    for (const row of hourlyData) {
      if (!map[row.system_id]) map[row.system_id] = []
      try {
        const metrics = JSON.parse(row.metrics_json) as Record<string, number>
        map[row.system_id].push({ v: metrics.cpu_avg ?? 0 })
      } catch {
        // skip malformed
      }
    }
    return map
  }, [hourlyData])

  // 필터링
  const filteredSystems =
    filterStatus === 'all' ? systems : systems.filter((s) => s.status === filterStatus)

  // 정렬
  const sortedSystems = [...filteredSystems].sort((a, b) => {
    if (sortBy === 'status') {
      const statusOrder = { critical: 0, warning: 1, normal: 2 }
      const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 999
      const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 999
      return aOrder - bOrder
    }
    return a.display_name.localeCompare(b.display_name)
  })

  if (systems.length === 0) {
    return (
      <EmptyState
        icon={<Server className="h-12 w-12" />}
        title="등록된 시스템이 없습니다"
        description="시스템을 등록하면 모니터링이 시작됩니다"
        cta={onAddSystem ? { label: '시스템 등록', onClick: onAddSystem } : undefined}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 필터 + 정렬 — 뉴모피즘 탭 패턴 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-text-disabled text-xs font-semibold uppercase">필터</span>
          <div className="bg-bg-base shadow-neu-pressed flex gap-0.5 rounded-sm p-1">
            {(['all', 'critical', 'warning', 'normal'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={cn(
                  'rounded-sm px-3 py-1.5 text-xs font-medium transition-all duration-150',
                  'focus:ring-accent focus:ring-1 focus:outline-none',
                  filterStatus === status
                    ? 'bg-accent text-bg-base font-semibold shadow-[2px_2px_4px_#111317]'
                    : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
                )}
              >
                {FILTER_LABELS[status]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-text-disabled text-xs font-semibold uppercase">정렬</span>
          <div className="bg-bg-base shadow-neu-pressed flex gap-0.5 rounded-sm p-1">
            {(['status', 'name'] as const).map((sort) => (
              <button
                key={sort}
                onClick={() => setSortBy(sort)}
                className={cn(
                  'rounded-sm px-3 py-1.5 text-xs font-medium transition-all duration-150',
                  'focus:ring-accent focus:ring-1 focus:outline-none',
                  sortBy === sort
                    ? 'bg-accent text-bg-base font-semibold shadow-[2px_2px_4px_#111317]'
                    : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
                )}
              >
                {SORT_LABELS[sort]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 결과 카운트 */}
      <div className="text-text-disabled text-xs">
        {filteredSystems.length} / {systems.length} 시스템
      </div>

      {/* 시스템 리스트 — NeuCard 컨테이너 */}
      {filteredSystems.length === 0 ? (
        <NeuCard className="text-text-secondary py-8 text-center">
          선택한 필터에 해당하는 시스템이 없습니다
        </NeuCard>
      ) : (
        <NeuCard className="overflow-hidden !p-0">
          {sortedSystems.map((system, idx) => (
            <EnhancedSystemCard
              key={system.system_id}
              system={system}
              sparkData={sparkDataMap[Number(system.system_id)]}
              showTopBorder={idx > 0}
            />
          ))}
        </NeuCard>
      )}
    </div>
  )
})
