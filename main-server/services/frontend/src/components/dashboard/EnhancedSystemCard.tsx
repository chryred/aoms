import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, AlertTriangle, CheckCircle, ChevronRight, ShieldAlert } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
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
    bgColor: 'bg-red-500/10',
    borderColor: 'border-l-4 border-red-500/50',
    label: '위험',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-l-4 border-yellow-500/50',
    label: '경고',
  },
  normal: {
    icon: CheckCircle,
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-l-4 border-green-500/50',
    label: '정상',
  },
}

export const EnhancedSystemCard = memo(function EnhancedSystemCard({
  system,
}: EnhancedSystemCardProps) {
  const navigate = useNavigate()
  const statusConfig = STATUS_CONFIG[system.status as keyof typeof STATUS_CONFIG]
  const Icon = statusConfig.icon

  const handleClick = () => {
    navigate(ROUTES.systemDetail(system.system_id))
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full text-left transition-all duration-150',
        'hover:shadow-2xl hover:brightness-110',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A8B5C3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0F1116]',
        'active:shadow-lg',
        'group',
      )}
    >
      <NeuCard
        className={cn(
          'relative h-full cursor-pointer overflow-hidden transition-all duration-200',
          statusConfig.borderColor,
        )}
      >
        {/* 배경 액센트 */}
        <div className={cn('absolute inset-0 opacity-[0.02]', statusConfig.bgColor)} />

        <div className="relative flex flex-col gap-3">
          {/* 헤더: 상태 + 시스템명 + 화살표 */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', statusConfig.color)} />
                <span className={cn('text-xs font-semibold uppercase', statusConfig.color)}>
                  {statusConfig.label}
                </span>
              </div>
              <h3 className="line-clamp-2 text-sm leading-snug font-semibold break-words text-[#E2E8F2] sm:text-base">
                {system.display_name}
              </h3>
              <p className="mt-0.5 truncate font-mono text-xs text-[#8B97AD]">
                {system.system_name}
              </p>
            </div>
            <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-[#8B97AD] transition-all duration-200 group-hover:translate-x-1 group-hover:text-[#00D4FF]" />
          </div>

          {/* 사유: 한줄 코멘트 */}
          <div className="rounded-md border border-[#2A3447]/50 bg-[#1F2937]/40 px-3 py-2.5">
            <p className="line-clamp-3 text-xs leading-relaxed break-words text-[#A8B5C3]">
              {system.reason || '상태 정보 수집 중...'}
            </p>
          </div>

          {/* 하단: 예방 패턴 뱃지 */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#8B97AD]">
            {system.proactive_count > 0 && (
              <span className="flex items-center gap-1 rounded-sm bg-purple-500/10 px-2 py-0.5 whitespace-nowrap text-purple-400">
                <ShieldAlert className="h-3 w-3 flex-shrink-0" />
                예방 {system.proactive_count}건
              </span>
            )}
          </div>
        </div>
      </NeuCard>
    </button>
  )
})
