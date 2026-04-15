import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  TrendingUp,
  Radio,
  Activity,
  Gauge,
} from 'lucide-react'
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

function glowShadow(color: string, opacity = 0.15) {
  return `shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37,0_0_12px_rgba(${color},${opacity})]`
}

const GLOW_RED = glowShadow('239,68,68', 0.2)
const GLOW_YELLOW = glowShadow('245,158,11', 0.15)
const GLOW_BLUE = glowShadow('59,130,246', 0.12)
const GLOW_PURPLE = glowShadow('168,85,247', 0.12)
const GLOW_SKY = glowShadow('125,211,252', 0.15)

// ── StatCell 내부 컴포넌트 ───────────────────────────────────────────────

interface StatCellProps {
  label: string
  value: number
  total?: number
  icon: React.ElementType
  color: string
  glowClass?: string
  borderClass?: string
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
  borderClass,
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
        ? cn(glowClass, 'border-l-4 px-3.5 py-3', borderClass, bgClass)
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
        <h2 className="text-text-primary mb-3 flex items-center gap-2 text-lg font-semibold">
          <Activity className="h-5 w-5" />
          시스템 상태
        </h2>
        <div className="flex flex-wrap gap-2">
          <StatCell
            label="위험"
            value={summary.critical_systems}
            icon={AlertCircle}
            color="text-red-500"
            glowClass={GLOW_RED}
            borderClass="border-red-500"
            bgClass="bg-critical-card-bg"
            onClick={() => handleStatusClick('critical')}
            ariaLabel={`위험 시스템 ${summary.critical_systems}개 보기`}
          />
          <StatCell
            label="경고"
            value={summary.warning_systems}
            icon={AlertTriangle}
            color="text-yellow-500"
            glowClass={GLOW_YELLOW}
            borderClass="border-yellow-500"
            bgClass="bg-warning-card-bg"
            onClick={() => handleStatusClick('warning')}
            ariaLabel={`경고 시스템 ${summary.warning_systems}개 보기`}
          />
          <StatCell
            label="정상"
            value={summary.normal_systems}
            icon={CheckCircle}
            color="text-green-500"
            onClick={() => handleStatusClick('normal')}
            ariaLabel={`정상 시스템 ${summary.normal_systems}개 보기`}
          />
        </div>
      </div>

      {/* 운영 현황 — 알림 / 예방 / 수집 */}
      <div>
        <h2 className="text-text-primary mb-3 flex items-center gap-2 text-lg font-semibold">
          <Gauge className="h-5 w-5" />
          운영 현황
        </h2>
        <div className="flex flex-wrap gap-2">
          <StatCell
            label="알림"
            value={summary.total_metric_alerts}
            icon={TrendingUp}
            color="text-blue-400"
            glowClass={GLOW_BLUE}
            borderClass="border-blue-500"
            bgClass="bg-[rgba(59,130,246,0.04)]"
            onClick={() => navigate(`${ROUTES.ALERTS}?acknowledged=unack`)}
            ariaLabel={`미확인 알림 ${summary.total_metric_alerts}건 보기`}
          />

          <StatCell
            label="예방"
            value={summary.proactive_systems ?? 0}
            icon={ShieldAlert}
            color="text-purple-400"
            glowClass={GLOW_PURPLE}
            borderClass="border-purple-500"
            bgClass="bg-[rgba(168,85,247,0.04)]"
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
                GLOW_SKY,
                'border-l-4 border-sky-300 bg-[rgba(125,211,252,0.04)] px-3.5 py-3',
              )}
            >
              <Radio className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" />
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold tabular-nums text-sky-300">
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
