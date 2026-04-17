import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, AlertTriangle, CheckCircle, ShieldAlert, TrendingUp, Radio } from 'lucide-react'
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
      <button type="button" onClick={onClick} aria-label={ariaLabel ?? label} className={baseClass}>
        {content}
      </button>
    )
  }

  return <div className={baseClass}>{content}</div>
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
      {/* 시스템 상태 — 위험 / 경고 / 정상 */}
      <div>
        <h2 className="text-text-primary mb-3 text-lg font-semibold">시스템 상태</h2>
        <div className="flex flex-wrap gap-2">
          <StatCell
            label="위험"
            value={summary.critical_systems}
            icon={AlertCircle}
            color="text-critical-text"
            glowClass="shadow-glow-critical"
            bgClass="bg-critical-card-bg"
            onClick={() => handleStatusClick('critical')}
            ariaLabel={`위험 시스템 ${summary.critical_systems}개 보기`}
          />
          <StatCell
            label="경고"
            value={summary.warning_systems}
            icon={AlertTriangle}
            color="text-warning-text"
            glowClass="shadow-glow-warning"
            bgClass="bg-warning-card-bg"
            onClick={() => handleStatusClick('warning')}
            ariaLabel={`경고 시스템 ${summary.warning_systems}개 보기`}
          />
          <StatCell
            label="정상"
            value={summary.normal_systems}
            icon={CheckCircle}
            color="text-normal-text"
            onClick={() => handleStatusClick('normal')}
            ariaLabel={`정상 시스템 ${summary.normal_systems}개 보기`}
          />
        </div>
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
          />

          {/* 수집 에이전트 — total > 0 일 때만 노출 */}
          {agentTotal > 0 ? (
            <button
              type="button"
              onClick={() => navigate(`${ROUTES.AGENTS}?health=stale`)}
              aria-label={`수집 중 에이전트 ${agentCollecting}/${agentTotal}, 중단된 에이전트 보기`}
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
