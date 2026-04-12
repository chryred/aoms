import { memo, useMemo } from 'react'
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
    dotBg: 'bg-green-500/50',
    borderColor: 'border-l-2 border-green-500/30',
    label: '정상',
  },
}

/** reason 문자열에서 "CPU 78%" 같은 메트릭 수치를 추출 */
function parseMetricChips(reason: string): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = []
  const regex = /(CPU|메모리|DB 커넥션|DB 캐시)\s+(\d+)%/g
  let match
  while ((match = regex.exec(reason)) !== null) {
    chips.push({ label: match[1], value: `${match[2]}%` })
  }
  return chips
}

/**
 * Dense row 시스템 카드.
 * 상태 dot + 시스템명 + 메트릭 칩 + 사유 + 예방 뱃지 + 상태 라벨 + 화살표.
 */
export const EnhancedSystemCard = memo(function EnhancedSystemCard({
  system,
}: EnhancedSystemCardProps) {
  const navigate = useNavigate()
  const statusConfig = STATUS_CONFIG[system.status as keyof typeof STATUS_CONFIG]
  const metricChips = useMemo(() => parseMetricChips(system.reason || ''), [system.reason])

  const handleClick = () => {
    navigate(ROUTES.systemDetail(system.system_id))
  }

  // reason에서 메트릭 수치를 제외한 나머지 텍스트
  const reasonText = useMemo(() => {
    if (!system.reason) return '모니터링 정상'
    let text = system.reason
    // 메트릭 수치 부분 제거
    text = text.replace(/(CPU|메모리|DB 커넥션|DB 캐시)\s+\d+%/g, '').trim()
    // 쉼표/공백 정리
    text = text.replace(/^[,\s]+|[,\s]+$/g, '').replace(/,\s*,/g, ',')
    return text || '모니터링 정상'
  }, [system.reason])

  return (
    <button
      onClick={handleClick}
      className={cn(
        'flex w-full items-center gap-3 bg-[#1E2127] px-4 py-3.5 text-left transition-all duration-100',
        'hover:bg-[#252932]',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#00D4FF]',
        'group',
        statusConfig.borderColor,
      )}
    >
      {/* 상태 dot */}
      <div className={cn('h-2 w-2 flex-shrink-0 rounded-full', statusConfig.dotBg)} />

      {/* 시스템 이름 */}
      <div className="min-w-0 flex-shrink-0" style={{ width: '160px' }}>
        <p className="truncate text-sm font-semibold text-[#E2E8F2]">
          {system.display_name}
        </p>
        <p className="truncate font-mono text-xs text-[#5A6478]">{system.system_name}</p>
      </div>

      {/* 메트릭 칩 (CPU, 메모리 등) — 상세 페이지 수집 현황과 연결 */}
      {metricChips.length > 0 && (
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {metricChips.map((chip) => (
            <span
              key={chip.label}
              className="rounded-sm bg-[#2B2F37] px-2 py-0.5 font-mono text-xs tabular-nums text-[#A8B5C3]"
            >
              {chip.label} <span className="text-[#E2E8F2]">{chip.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* 사유 — 유동 너비 */}
      <p className="min-w-0 flex-1 truncate text-xs text-[#8B97AD]">{reasonText}</p>

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
