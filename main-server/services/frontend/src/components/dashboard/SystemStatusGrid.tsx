import { memo } from 'react'
import { SystemStatusCard } from './SystemStatusCard'
import { EmptyState } from '@/components/common/EmptyState'
import { Server } from 'lucide-react'
import type { System } from '@/types/system'

interface SystemStatusGridProps {
  systems: System[]
  onAddSystem?: () => void
}

export const SystemStatusGrid = memo(function SystemStatusGrid({ systems, onAddSystem }: SystemStatusGridProps) {
  if (systems.length === 0) {
    return (
      <EmptyState
        icon={<Server className="w-12 h-12" />}
        title="등록된 시스템이 없습니다"
        description="시스템을 등록하면 모니터링이 시작됩니다"
        cta={onAddSystem ? { label: '시스템 등록', onClick: onAddSystem } : undefined}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {systems.map((system) => (
        <SystemStatusCard key={system.id} system={system} />
      ))}
    </div>
  )
})
