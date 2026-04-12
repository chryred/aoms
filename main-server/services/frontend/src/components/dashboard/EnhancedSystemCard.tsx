import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, AlertTriangle, CheckCircle, ChevronRight, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import type { SystemHealthData } from '@/hooks/queries/useDashboardHealth'

interface EnhancedSystemCardProps {
  system: SystemHealthData
}

const STATUS_CONFIG = {
  critical: {
    icon: AlertCircle,
    color: 'text-red-500',
    dotBg: 'bg-red-500',
    borderColor: 'border-l-2 border-red-500',
    label: '위험',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-yellow-500',
    dotBg: 'bg-yellow-500',
    borderColor: 'border-l-2 border-yellow-500',
    label: '경고',
  },
  normal: {
    icon: CheckCircle,
    color: 'text-green-500',
    dotBg: 'bg-green-500',
    borderColor: 'border-l-2 border-green-500/50',
    label: '정상',
  },
}

/**
 * Dense row 스타일 시스템 카드.
 * 한 행에 상태 dot + 시스템명 + 사유 + 예방 뱃지 + 화살표를 표시.
 */
export const EnhancedSystemCard = memo(function EnhancedSystemCard({
  system,
}: EnhancedSystemCardProps) {
  const navigate = useNavigate()
  const statusConfig = STATUS_CONFIG[system.status as keyof typeof STATUS_CONFIG]

  const handleClick = () => {
    navigate(ROUTES.systemDetail(system.system_id))
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-sm bg-[#1E2127] px-4 py-3 text-left transition-all duration-100',
        'hover:bg-[#252932] hover:shadow-lg',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#00D4FF]',
        'group',
        statusConfig.borderColor,
      )}
    >
      {/* 상태 dot */}
      <div className={cn('h-2 w-2 flex-shrink-0 rounded-full', statusConfig.dotBg)} />

      {/* 시스템 이름 */}
      <div className="min-w-0 flex-shrink-0" style={{ width: '180px' }}>
        <p className="truncate text-sm font-semibold text-[#E2E8F2]">
          {system.display_name}
        </p>
        <p className="truncate font-mono text-xs text-[#5A6478]">
          {system.system_name}
        </p>
      </div>

      {/* 사유 — 유동 너비 */}
      <p className="min-w-0 flex-1 truncate text-xs text-[#8B97AD]">
        {system.reason || '모니터링 정상'}
      </p>

      {/* 예방 패턴 */}
      {system.proactive_count > 0 && (
        <span className="flex flex-shrink-0 items-center gap-1 rounded-sm bg-purple-500/10 px-2 py-0.5 text-xs whitespace-nowrap text-purple-400">
          <ShieldAlert className="h-3 w-3" />
          {system.proactive_count}
        </span>
      )}

      {/* 상태 라벨 */}
      <span className={cn('flex-shrink-0 text-xs font-semibold', statusConfig.color)}>
        {statusConfig.label}
      </span>

      {/* 화살표 */}
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-[#5A6478] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#00D4FF]" />
    </button>
  )
})
