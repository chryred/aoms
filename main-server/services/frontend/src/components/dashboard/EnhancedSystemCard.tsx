import { memo, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import { Sparkline } from '@/components/charts/Sparkline'
import type { SystemHealthData } from '@/hooks/queries/useDashboardHealth'

interface EnhancedSystemCardProps {
  system: SystemHealthData
  sparkData?: { v: number }[]
  showTopBorder?: boolean
}

const STATUS_CONFIG = {
  critical: {
    color: 'text-red-500',
    dotBg: 'bg-red-500',
    borderColor: 'border-l-4 border-red-500',
    sparkColor: '#EF4444',
    label: '위험',
  },
  warning: {
    color: 'text-yellow-500',
    dotBg: 'bg-yellow-500',
    borderColor: 'border-l-4 border-yellow-500',
    sparkColor: '#F59E0B',
    label: '경고',
  },
  normal: {
    color: 'text-green-500',
    dotBg: 'bg-green-500/50',
    borderColor: 'border-l-4 border-green-500/30',
    sparkColor: '#00D4FF',
    label: '정상',
  },
}

// ── 메트릭 칩 ────────────────────────────────────────────────────────────

interface MetricChip {
  label: string
  value: string
  numericValue: number
  level: 'normal' | 'warning' | 'critical'
}

const CHIP_STYLES = {
  critical: 'bg-[rgba(239,68,68,0.10)] border border-[rgba(239,68,68,0.20)] text-[#F87171]',
  warning: 'bg-[rgba(245,158,11,0.10)] border border-[rgba(245,158,11,0.20)] text-[#FCD34D]',
  normal: 'bg-[#2B2F37] text-[#8B97AD]',
}

function parseMetricChips(reason: string): MetricChip[] {
  const chips: MetricChip[] = []
  const regex = /(CPU|메모리|DB 커넥션|DB 캐시)\s+(\d+)%/g
  let match
  while ((match = regex.exec(reason)) !== null) {
    const numericValue = parseInt(match[2], 10)
    let level: MetricChip['level'] = 'normal'
    if (numericValue > 80) level = 'critical'
    else if (numericValue > 60) level = 'warning'
    chips.push({ label: match[1], value: `${match[2]}%`, numericValue, level })
  }
  return chips
}

// ── EnhancedSystemCard ───────────────────────────────────────────────────

export const EnhancedSystemCard = memo(function EnhancedSystemCard({
  system,
  sparkData,
  showTopBorder = false,
}: EnhancedSystemCardProps) {
  const navigate = useNavigate()
  const statusConfig = STATUS_CONFIG[system.status as keyof typeof STATUS_CONFIG]
  const metricChips = useMemo(() => parseMetricChips(system.reason || ''), [system.reason])

  const reasonText = useMemo(() => {
    if (!system.reason) return '모니터링 정상'
    let text = system.reason
    text = text.replace(/(CPU|메모리|DB 커넥션|DB 캐시)\s+\d+%/g, '').trim()
    text = text.replace(/^[,/\s]+|[,/\s]+$/g, '').replace(/[/]\s*[/]/g, '/')
    return text || '모니터링 정상'
  }, [system.reason])

  return (
    <button
      onClick={() => navigate(ROUTES.systemDetail(system.system_id))}
      className={cn(
        'flex w-full items-center gap-3 bg-[#1E2127] px-4 py-2.5 text-left transition-all duration-100',
        'hover:bg-[rgba(0,212,255,0.04)]',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#00D4FF]',
        'group',
        statusConfig.borderColor,
        showTopBorder && 'border-t border-[#2B2F37]',
      )}
    >
      {/* 상태 dot */}
      <div className={cn('h-2 w-2 flex-shrink-0 rounded-full', statusConfig.dotBg)} />

      {/* 시스템 이름 */}
      <div className="min-w-0 flex-shrink-0" style={{ width: '160px' }}>
        <p className="truncate text-sm font-semibold text-[#E2E8F2]">{system.display_name}</p>
        <p className="truncate font-mono text-xs text-[#5A6478]">{system.system_name}</p>
      </div>

      {/* 메트릭 칩 (semantic 색상) */}
      {metricChips.length > 0 && (
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {metricChips.map((chip) => (
            <span
              key={chip.label}
              className={cn(
                'rounded-sm px-2 py-0.5 font-mono text-xs tabular-nums',
                CHIP_STYLES[chip.level],
              )}
            >
              {chip.label} {chip.value}
            </span>
          ))}
        </div>
      )}

      {/* 스파크라인 */}
      {sparkData && sparkData.length >= 2 && (
        <div className="w-20 flex-shrink-0">
          <Sparkline data={sparkData} color={statusConfig.sparkColor} height={28} />
        </div>
      )}

      {/* 사유 */}
      <p className="min-w-0 flex-1 truncate text-xs text-[#8B97AD]">{reasonText}</p>

      {/* 예방 패턴 */}
      {system.proactive_count > 0 && (
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full border border-[rgba(168,85,247,0.25)] bg-[rgba(168,85,247,0.12)] px-2 py-0.5 text-xs whitespace-nowrap text-purple-400">
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
