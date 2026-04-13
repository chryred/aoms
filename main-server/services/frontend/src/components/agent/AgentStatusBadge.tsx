import { cn } from '@/lib/utils'
import type { AgentStatus } from '@/types/agent'

const STATUS_MAP: Record<AgentStatus, { label: string; color: string }> = {
  running: { label: '실행 중', color: 'text-normal bg-[rgba(34,197,94,0.10)]' },
  stopped: { label: '중지', color: 'text-critical bg-critical-card-bg' },
  installed: { label: '설치됨', color: 'text-warning bg-[rgba(245,158,11,0.10)]' },
  unknown: { label: '알 수 없음', color: 'text-text-secondary bg-[rgba(139,151,173,0.10)]' },
}

interface AgentStatusBadgeProps {
  status: AgentStatus
  className?: string
}

export function AgentStatusBadge({ status, className }: AgentStatusBadgeProps) {
  const { label, color } = STATUS_MAP[status] ?? STATUS_MAP.unknown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        color,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}
