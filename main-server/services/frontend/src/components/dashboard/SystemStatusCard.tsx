import { memo } from 'react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { Monitor, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { System } from '@/types/system'

const TYPE_LABELS: Record<string, string> = {
  web: 'Web',
  was: 'WAS',
  db: 'DB',
  middleware: 'MW',
  other: 'etc',
}

interface SystemStatusCardProps {
  system: System
}

export const SystemStatusCard = memo(function SystemStatusCard({ system }: SystemStatusCardProps) {
  const isActive = system.status === 'active'

  return (
    <NeuCard className="flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#E2E8F2] truncate">{system.display_name}</p>
          <p className="text-xs text-[#8B97AD] truncate font-mono">{system.system_name}</p>
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <span
            className={cn(
              'inline-block w-2 h-2 rounded-full',
              isActive ? 'bg-[#22C55E]' : 'bg-[#5A6478]'
            )}
          />
          <span className={cn('text-xs', isActive ? 'text-[#22C55E]' : 'text-[#5A6478]')}>
            {isActive ? '운영 중' : '비활성'}
          </span>
        </div>
      </div>

      {/* 정보 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[#8B97AD]">
          {system.os_type === 'linux'
            ? <Terminal className="w-3.5 h-3.5" />
            : <Monitor className="w-3.5 h-3.5" />}
          <span className="text-xs truncate max-w-32">{system.host}</span>
        </div>
        <NeuBadge variant="info">{TYPE_LABELS[system.system_type] ?? system.system_type}</NeuBadge>
      </div>
    </NeuCard>
  )
})
