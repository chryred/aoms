import { memo, useState } from 'react'
import { EnhancedSystemCard } from './EnhancedSystemCard'
import { EmptyState } from '@/components/common/EmptyState'
import { Server } from 'lucide-react'
import type { SystemHealthData } from '@/hooks/queries/useDashboardHealth'

type SortKey = 'status' | 'name'
type FilterStatus = 'all' | 'critical' | 'warning' | 'normal'

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
      {/* 필터 및 정렬 탭 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 상태 필터 */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-xs font-semibold text-[#8B97AD] uppercase">필터:</span>
          <div className="flex flex-wrap gap-1">
            {(['all', 'critical', 'warning', 'normal'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`min-h-[32px] rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none ${
                  filterStatus === status
                    ? status === 'all'
                      ? 'bg-[#A8B5C3] text-[#1A202C] shadow-md focus-visible:ring-[#A8B5C3]/50'
                      : status === 'critical'
                        ? 'border border-red-500/30 bg-red-500/20 text-red-400 shadow-md focus-visible:ring-red-500/50'
                        : status === 'warning'
                          ? 'border border-yellow-500/30 bg-yellow-500/20 text-yellow-400 shadow-md focus-visible:ring-yellow-500/50'
                          : 'border border-green-500/30 bg-green-500/20 text-green-400 shadow-md focus-visible:ring-green-500/50'
                    : 'bg-[#2A3447]/30 text-[#8B97AD] hover:bg-[#2A3447]/50 hover:text-[#E2E8F2] hover:shadow-md focus-visible:ring-[#8B97AD]/50'
                }`}
              >
                {status === 'all'
                  ? '전체'
                  : status === 'critical'
                    ? '위험'
                    : status === 'warning'
                      ? '경고'
                      : '정상'}
              </button>
            ))}
          </div>
        </div>

        {/* 정렬 옵션 */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-xs font-semibold text-[#8B97AD] uppercase">정렬:</span>
          <div className="flex gap-1">
            {(['status', 'name'] as const).map((sort) => (
              <button
                key={sort}
                onClick={() => setSortBy(sort)}
                className={`min-h-[32px] rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none ${
                  sortBy === sort
                    ? 'bg-[#A8B5C3] text-[#1A202C] shadow-md focus-visible:ring-[#A8B5C3]/50'
                    : 'bg-[#2A3447]/30 text-[#8B97AD] hover:bg-[#2A3447]/50 hover:text-[#E2E8F2] hover:shadow-md focus-visible:ring-[#8B97AD]/50'
                }`}
              >
                {sort === 'status' ? '상태순' : '이름순'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 필터링된 결과 개수 */}
      <div className="text-xs text-[#8B97AD]">
        {filteredSystems.length} / {systems.length} 시스템
      </div>

      {/* 시스템 그리드 */}
      {filteredSystems.length === 0 ? (
        <div className="py-8 text-center text-[#8B97AD]">
          선택한 필터에 해당하는 시스템이 없습니다
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedSystems.map((system) => (
            <EnhancedSystemCard key={system.system_id} system={system} />
          ))}
        </div>
      )}
    </div>
  )
})
