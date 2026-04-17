import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert, TrendingUp, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import type { DashboardSummary } from '@/hooks/queries/useDashboardHealth'
import type { AgentHealthSummary } from '@/types/agent'

type StatusFilter = 'critical' | 'warning' | 'normal'

interface DashboardSummaryProps {
  summary: DashboardSummary
}

// ── 뉴모피즘 그림자 토큰 ─────────────────────────────────────────────────
const NEU_RAISED = 'shadow-neu-flat'
const NEU_PRESSED = 'shadow-neu-pressed'

// ── StatCell 내부 컴포넌트 ───────────────────────────────────────────────

interface StatCellProps {
  label: string
  value: number
  total?: number
  icon: React.ElementType
  color: string
  glowClass?: string
  bgClass?: string
  onClick?: () => void
  ariaLabel?: string
  tooltip?: string
}

function StatCell({
  label,
  value,
  total,
  icon: Icon,
  color,
  glowClass,
  bgClass,
  onClick,
  ariaLabel,
  tooltip,
}: StatCellProps) {
  const isZero = value === 0
  const isAlerted = !isZero && glowClass !== undefined
  const clickable = typeof onClick === 'function'

  const baseClass = cn(
    'bg-bg-base flex min-w-[100px] flex-1 items-center gap-2.5 rounded-sm transition-shadow duration-200',
    isZero
      ? cn(NEU_PRESSED, 'px-3 py-2')
      : isAlerted
        ? cn(glowClass, 'px-3.5 py-3', bgClass)
        : cn(NEU_RAISED, 'px-3.5 py-3'),
    clickable &&
      'focus:ring-accent cursor-pointer text-left focus:ring-1 focus:outline-none hover:brightness-110',
  )

  const content = (
    <>
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', isZero ? 'text-text-disabled' : color)} />
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-bold tabular-nums',
            isZero
              ? 'text-text-disabled text-sm'
              : isAlerted
                ? cn('text-2xl', color)
                : cn('text-lg', color),
          )}
        >
          {value}
        </span>
        {total !== undefined && <span className="text-text-disabled text-xs">/{total}</span>}
      </div>
      <span className="text-text-secondary text-xs whitespace-nowrap">{label}</span>
    </>
  )

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? label}
        title={tooltip}
        className={baseClass}
      >
        {content}
      </button>
    )
  }

  return (
    <div title={tooltip} className={baseClass}>
      {content}
    </div>
  )
}

// ── SystemStatusBar — 3-card 대체 수평 비율 바 ──────────────────────────

interface SystemStatusBarProps {
  critical: number
  warning: number
  normal: number
  onFilterClick?: (status: StatusFilter) => void
}

function SystemStatusBar({ critical, warning, normal, onFilterClick }: SystemStatusBarProps) {
  const total = critical + warning + normal

  if (total === 0) {
    return (
      <div className="bg-bg-base shadow-neu-pressed text-text-disabled rounded-sm px-4 py-6 text-center text-sm">
        등록된 시스템이 없습니다
      </div>
    )
  }

  const criticalPct = (critical / total) * 100
  const warningPct = (warning / total) * 100
  const normalPct = (normal / total) * 100
  const hasCritical = critical > 0

  const segments = [
    {
      key: 'critical' as const,
      count: critical,
      pct: criticalPct,
      label: '위험',
      barClass: 'bg-critical',
      textClass: 'text-critical-text',
      dotClass: 'bg-critical',
    },
    {
      key: 'warning' as const,
      count: warning,
      pct: warningPct,
      label: '경고',
      barClass: 'bg-warning',
      textClass: 'text-warning-text',
      dotClass: 'bg-warning',
    },
    {
      key: 'normal' as const,
      count: normal,
      pct: normalPct,
      label: '정상',
      barClass: 'bg-normal',
      textClass: 'text-normal-text',
      dotClass: 'bg-normal',
    },
  ]

  return (
    <div className="space-y-3">
      {/* Hero: 위험 있으면 빨간 대형 숫자, 없으면 정상 초록 대형 */}
      <div className="flex items-baseline gap-2">
        {hasCritical ? (
          <>
            <span className="text-critical-text text-4xl font-bold tabular-nums">{critical}</span>
            <span className="text-critical-text text-sm font-semibold">위험 시스템</span>
            <span className="text-text-secondary text-xs">
              · {total}개 중 {criticalPct.toFixed(0)}%
            </span>
          </>
        ) : (
          <>
            <span className="text-normal-text text-4xl font-bold tabular-nums">{normal}</span>
            <span className="text-normal-text text-sm font-semibold">모두 정상</span>
            <span className="text-text-secondary text-xs">· {total}개 시스템</span>
          </>
        )}
      </div>

      {/* 수평 스택 바 */}
      <div className="bg-bg-base shadow-neu-pressed flex h-3 overflow-hidden rounded-sm">
        {segments.map((seg) =>
          seg.count > 0 ? (
            <button
              key={seg.key}
              type="button"
              onClick={() => onFilterClick?.(seg.key)}
              style={{ width: `${seg.pct}%` }}
              className={cn(
                seg.barClass,
                'focus:ring-accent transition-all hover:brightness-110 focus:ring-1 focus:outline-none',
              )}
              aria-label={`${seg.label} 시스템 ${seg.count}개 보기`}
              title={`${seg.label} ${seg.count}개 (${seg.pct.toFixed(0)}%)`}
            />
          ) : null,
        )}
      </div>

      {/* 범례 — 클릭 가능 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {segments.map((seg) => (
          <button
            key={seg.key}
            type="button"
            onClick={() => onFilterClick?.(seg.key)}
            className="focus:ring-accent flex items-center gap-1.5 rounded-sm px-1 py-0.5 hover:brightness-110 focus:ring-1 focus:outline-none"
            aria-label={`${seg.label} 시스템 ${seg.count}개 보기`}
          >
            <span className={cn('h-2 w-2 rounded-full', seg.dotClass)} />
            <span className="text-text-secondary">{seg.label}</span>
            <span className={cn('font-semibold tabular-nums', seg.textClass)}>{seg.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── DashboardSummaryStats ────────────────────────────────────────────────

interface DashboardSummaryStatsProps extends DashboardSummaryProps {
  agentSummary?: AgentHealthSummary
  onStatusCardClick?: (status: StatusFilter) => void
}

export const DashboardSummaryStats = memo(function DashboardSummaryStats({
  summary,
  agentSummary,
  onStatusCardClick,
}: DashboardSummaryStatsProps) {
  const navigate = useNavigate()
  const agentCollecting = agentSummary?.collecting ?? 0
  const agentTotal = agentSummary?.total ?? 0

  const handleStatusClick = (status: StatusFilter) => {
    onStatusCardClick?.(status)
  }

  return (
    <div className="space-y-4">
      {/* 시스템 상태 — 수평 비율 바 (hero 숫자 강조) */}
      <div>
        <h2 className="text-text-primary mb-3 text-lg font-semibold">시스템 상태</h2>
        <SystemStatusBar
          critical={summary.critical_systems}
          warning={summary.warning_systems}
          normal={summary.normal_systems}
          onFilterClick={handleStatusClick}
        />
      </div>

      {/* 운영 현황 — 알림 / 예방 / 수집 */}
      <div>
        <h2 className="text-text-primary mb-3 text-lg font-semibold">운영 현황</h2>
        <div className="flex flex-wrap gap-2">
          <StatCell
            label="알림"
            value={summary.total_metric_alerts}
            icon={TrendingUp}
            color="text-metric-alert-text"
            glowClass="shadow-glow-metric-alert"
            bgClass="bg-metric-alert-card-bg"
            onClick={() => navigate(`${ROUTES.ALERTS}?acknowledged=unack`)}
            ariaLabel={`미확인 알림 ${summary.total_metric_alerts}건 보기`}
            tooltip="아직 확인(acknowledge)되지 않은 메트릭 알림 건수 — 클릭하여 이력 열기"
          />

          <StatCell
            label="예방"
            value={summary.proactive_systems ?? 0}
            icon={ShieldAlert}
            color="text-proactive-text"
            glowClass="shadow-glow-proactive"
            bgClass="bg-proactive-card-bg"
            onClick={() => navigate(ROUTES.TRENDS)}
            ariaLabel={`예방 시스템 ${summary.proactive_systems ?? 0}개 보기`}
            tooltip="AI가 사전 탐지한 이상 패턴이 있는 시스템 수 — 장애 전 대응 가능"
          />

          {/* 수집 에이전트 — total > 0 일 때만 노출 */}
          {agentTotal > 0 ? (
            <button
              type="button"
              onClick={() => navigate(`${ROUTES.AGENTS}?health=stale`)}
              aria-label={`수집 중 에이전트 ${agentCollecting}/${agentTotal}, 중단된 에이전트 보기`}
              title={`데이터 수집 중인 에이전트 ${agentCollecting}/${agentTotal} — 클릭하여 중단된 에이전트 확인`}
              className={cn(
                'bg-bg-base flex min-w-[100px] flex-1 items-center gap-2.5 rounded-sm text-left transition-shadow duration-200',
                'focus:ring-accent cursor-pointer hover:brightness-110 focus:ring-1 focus:outline-none',
                'shadow-glow-agent-collect bg-agent-collect-card-bg px-3.5 py-3',
              )}
            >
              <Radio className="text-agent-collect-text h-3.5 w-3.5 flex-shrink-0" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-agent-collect-text text-lg font-bold tabular-nums">
                  {agentCollecting}
                </span>
                <span className="text-text-disabled text-xs">/{agentTotal}</span>
              </div>
              <span className="text-text-secondary text-xs whitespace-nowrap">수집</span>
            </button>
          ) : (
            <StatCell
              label="수집"
              value={0}
              icon={Radio}
              color="text-text-disabled"
              onClick={() => navigate(ROUTES.AGENTS)}
              ariaLabel="등록된 에이전트 없음, 에이전트 목록 보기"
              tooltip="등록된 에이전트 없음 — 클릭하여 에이전트 관리 페이지 이동"
            />
          )}
        </div>
      </div>
    </div>
  )
})

/** @deprecated DashboardLogAnalysisSummary는 DashboardSummaryStats에 통합됨 */
export const DashboardLogAnalysisSummary = memo(function DashboardLogAnalysisSummary({
  summary: _summary,
}: DashboardSummaryProps) {
  return null
})

/** @deprecated AgentHealthSummaryCard는 DashboardSummaryStats에 통합됨 */
export const AgentHealthSummaryCard = memo(function AgentHealthSummaryCard({
  summary: _summary,
}: {
  summary: AgentHealthSummary | undefined
}) {
  return null
})
