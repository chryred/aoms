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
          <p className="text-text-primary truncate font-semibold">{system.display_name}</p>
          <p className="text-text-secondary truncate font-mono text-xs">{system.system_name}</p>
        </div>
        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              isActive ? 'bg-normal' : 'bg-text-disabled',
            )}
          />
          <span className={cn('text-xs', isActive ? 'text-normal' : 'text-text-disabled')}>
            {isActive ? '운영 중' : '비활성'}
          </span>
        </div>
      </div>
    </NeuCard>
  )
})
