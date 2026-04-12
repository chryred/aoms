import { memo } from 'react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { cn } from '@/lib/utils'
import type { System } from '@/types/system'

interface SystemStatusCardProps {
  system: System
}

export const SystemStatusCard = memo(function SystemStatusCard({ system }: SystemStatusCardProps) {
  const isActive = system.status === 'active'

  return (
    <NeuCard className="flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[#E2E8F2]">{system.display_name}</p>
          <p className="truncate font-mono text-xs text-[#8B97AD]">{system.system_name}</p>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              isActive ? 'bg-[#22C55E]' : 'bg-[#5A6478]',
            )}
          />
          <span className={cn('text-xs', isActive ? 'text-[#22C55E]' : 'text-[#5A6478]')}>
            {isActive ? '운영 중' : '비활성'}
          </span>
        </div>
      </div>
    </NeuCard>
  )
})
