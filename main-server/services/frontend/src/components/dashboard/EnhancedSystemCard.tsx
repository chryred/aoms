import { memo, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import { Sparkline } from '@/components/charts/Sparkline'
import type { SystemHealthData, InstanceHealth } from '@/hooks/queries/useDashboardHealth'

interface EnhancedSystemCardProps {
  system: SystemHealthData
  sparkData?: { v: number }[]
  showTopBorder?: boolean
}

const STATUS_CONFIG = {
  critical: {
    color: 'text-critical-text',
    dotBg: 'bg-critical',
    bgColor: 'bg-critical-card-bg',
    sparkColor: 'var(--t-critical)',
    label: '위험',
  },
  warning: {
    color: 'text-warning-text',
    dotBg: 'bg-warning',
    bgColor: 'bg-warning-card-bg',
    sparkColor: 'var(--t-warning)',
    label: '경고',
  },
  normal: {
    color: 'text-normal-text',
    dotBg: 'bg-normal/50',
    bgColor: '',
    sparkColor: 'var(--t-accent)',
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
  critical: 'bg-critical-bg border border-critical-border text-critical-text',
  warning: 'bg-warning-bg border border-warning-border text-warning-text',
  normal: 'bg-border text-text-secondary',
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

// ── InstanceMiniGrid ─────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  normal: 'bg-normal',
  warning: 'bg-warning',
  critical: 'bg-critical',
  inactive: 'bg-text-disabled',
}

const TYPE_ORDER = ['was', 'web', 'db', 'middleware', 'other'] as const

function InstanceMiniGrid({ instances }: { instances: InstanceHealth[] | undefined }) {
  if (!instances?.length) return null

  const groups = TYPE_ORDER.map((type) => ({
    type,
    items: instances.filter((i) => (i.server_type ?? 'other') === type),
  })).filter((g) => g.items.length > 0)

  if (groups.length === 0) return null

  return (
    <div className="border-border flex flex-wrap items-center gap-2 border-t px-4 py-1.5">
      {groups.map((group, gi) => (
        <Fragment key={group.type}>
          {gi > 0 && (
            <span aria-hidden className="text-text-disabled mx-0.5">
              |
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-text-disabled text-[10px] uppercase">{group.type}</span>
            {group.items.map((inst) => (
              <span
                key={inst.instance_role}
                className={cn(
                  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px]',
                  inst.status === 'critical' && 'bg-critical/10',
                  inst.status === 'warning' && 'bg-warning/10',
                )}
                title={`${inst.instance_role}${inst.worst_metric ? ` — ${inst.worst_metric}` : ''}`}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    STATUS_DOT[inst.status] ?? 'bg-text-disabled',
                  )}
                />
                <span className="text-text-secondary font-mono">{inst.instance_role}</span>
              </span>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  )
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

  const hasInstances = (system.instances?.length ?? 0) > 0

  return (
    // flex-col wrapper so the mini-grid sits below the main row
    <div
      className={cn(
        'bg-bg-base w-full text-left transition-all duration-100',
        statusConfig.bgColor,
        showTopBorder && 'border-border border-t',
        'group',
      )}
    >
      <button
        onClick={() => navigate(ROUTES.systemDetail(system.system_id))}
        className={cn(
          'flex w-full items-center gap-3 px-4 text-left',
          hasInstances ? 'py-2' : 'py-2.5',
          'group-hover:bg-accent-muted',
          'focus-visible:ring-accent focus:outline-none focus-visible:ring-1',
        )}
      >
        {/* 상태 dot */}
        <div className={cn('h-2 w-2 flex-shrink-0 rounded-full', statusConfig.dotBg)} />

        {/* 시스템 이름 */}
        <div className="min-w-0 flex-shrink-0" style={{ width: '160px' }}>
          <p className="text-text-primary truncate text-sm font-semibold">{system.display_name}</p>
          <p className="text-text-disabled truncate font-mono text-xs">{system.system_name}</p>
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
        <p className="text-text-secondary min-w-0 flex-1 truncate text-xs">{reasonText}</p>

        {/* 예방 패턴 */}
        {system.proactive_count > 0 && (
          <span className="border-proactive-border bg-proactive-bg text-proactive-text flex flex-shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap">
            <ShieldAlert className="h-3 w-3" />
            {system.proactive_count}
          </span>
        )}

        {/* 상태 라벨 */}
        <span className={cn('flex-shrink-0 text-xs font-semibold', statusConfig.color)}>
          {statusConfig.label}
        </span>

        {/* 화살표 */}
        <ChevronRight className="text-text-disabled group-hover:text-accent h-4 w-4 flex-shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
      </button>

      {/* 인스턴스 미니 그리드 (백엔드에서 instances 데이터가 있을 때만 표시) */}
      <InstanceMiniGrid instances={system.instances} />
    </div>
  )
})
