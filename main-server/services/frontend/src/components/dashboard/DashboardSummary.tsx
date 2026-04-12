import { memo } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  TrendingUp,
  Radio,
  FileWarning,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DashboardSummary } from '@/hooks/queries/useDashboardHealth'
import type { AgentHealthSummary } from '@/types/agent'

interface DashboardSummaryProps {
  summary: DashboardSummary
}

// ── 뉴모피즘 그림자 토큰 ─────────────────────────────────────────────────
const NEU_RAISED = 'shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]'
const NEU_PRESSED = 'shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]'

function glowShadow(color: string, opacity = 0.15) {
  return `shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37,0_0_12px_rgba(${color},${opacity})]`
}

const GLOW_RED = glowShadow('239,68,68', 0.2)
const GLOW_YELLOW = glowShadow('245,158,11', 0.15)
const GLOW_BLUE = glowShadow('59,130,246', 0.12)
const GLOW_PURPLE = glowShadow('168,85,247', 0.12)

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
}: StatCellProps) {
  const isZero = value === 0
  const isAlerted = !isZero && glowClass !== undefined

  return (
    <div
      className={cn(
        'flex min-w-[100px] flex-1 items-center gap-2.5 rounded-sm bg-[#1E2127] transition-shadow duration-200',
        isZero
          ? cn(NEU_PRESSED, 'px-3 py-2')
          : isAlerted
            ? cn(glowClass, 'border-l-4 px-3.5 py-3', borderClass, bgClass)
            : cn(NEU_RAISED, 'px-3.5 py-3'),
      )}
    >
      <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', isZero ? 'text-[#5A6478]' : color)} />
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-bold tabular-nums',
            isZero
              ? 'text-sm text-[#5A6478]'
              : isAlerted
                ? cn('text-2xl', color)
                : cn('text-lg', color),
          )}
        >
          {value}
        </span>
        {total !== undefined && <span className="text-xs text-[#5A6478]">/{total}</span>}
      </div>
      <span className="text-xs whitespace-nowrap text-[#8B97AD]">{label}</span>
    </div>
  )
}

// ── DashboardSummaryStats ────────────────────────────────────────────────

export const DashboardSummaryStats = memo(function DashboardSummaryStats({
  summary,
  agentSummary,
}: DashboardSummaryProps & { agentSummary?: AgentHealthSummary }) {
  const agentCollecting = agentSummary?.collecting ?? 0
  const agentTotal = agentSummary?.total ?? 0
  const agentAllOk = agentTotal > 0 && agentCollecting === agentTotal
  const agentHasStale = (agentSummary?.stale ?? 0) > 0

  return (
    <div className="space-y-4">
      {/* 시스템 상태 */}
      <div>
        <p className="mb-2 text-xs font-semibold text-[#5A6478] uppercase">시스템 상태</p>
        <div className="flex flex-wrap gap-2">
          <StatCell
            label="위험"
            value={summary.critical_systems}
            icon={AlertCircle}
            color="text-red-500"
            glowClass={GLOW_RED}
            borderClass="border-red-500"
            bgClass="bg-[rgba(239,68,68,0.06)]"
          />
          <StatCell
            label="경고"
            value={summary.warning_systems}
            icon={AlertTriangle}
            color="text-yellow-500"
            glowClass={GLOW_YELLOW}
            borderClass="border-yellow-500"
            bgClass="bg-[rgba(245,158,11,0.04)]"
          />
          <StatCell
            label="정상"
            value={summary.normal_systems}
            icon={CheckCircle}
            color="text-green-500"
          />
          <StatCell
            label="예방"
            value={summary.proactive_systems ?? 0}
            icon={ShieldAlert}
            color="text-purple-400"
            glowClass={GLOW_PURPLE}
            borderClass="border-purple-500"
            bgClass="bg-[rgba(168,85,247,0.04)]"
          />
        </div>
      </div>

      {/* 운영 현황 */}
      <div>
        <p className="mb-2 text-xs font-semibold text-[#5A6478] uppercase">운영 현황</p>
        <div className="flex flex-wrap gap-2">
          <StatCell
            label="알림"
            value={summary.total_metric_alerts}
            icon={TrendingUp}
            color="text-blue-400"
            glowClass={GLOW_BLUE}
            borderClass="border-blue-500"
            bgClass="bg-[rgba(59,130,246,0.04)]"
          />

          {/* 에이전트 — "에이\n전트" 2줄 라벨 */}
          {agentTotal > 0 && (
            <div
              className={cn(
                'flex min-w-[100px] flex-1 items-center gap-2.5 rounded-sm bg-[#1E2127] transition-shadow duration-200',
                agentHasStale
                  ? cn(GLOW_RED, 'border-l-4 border-red-500 bg-[rgba(239,68,68,0.06)] px-3.5 py-3')
                  : agentAllOk
                    ? cn(NEU_RAISED, 'px-3.5 py-3')
                    : cn(NEU_PRESSED, 'px-3 py-2'),
              )}
            >
              <Radio
                className={cn(
                  'h-3.5 w-3.5 flex-shrink-0',
                  agentAllOk
                    ? 'text-green-500'
                    : agentHasStale
                      ? 'text-red-500'
                      : 'text-yellow-500',
                )}
              />
              <div className="flex items-baseline gap-1.5">
                <span
                  className={cn(
                    'text-lg font-bold tabular-nums',
                    agentAllOk ? 'text-green-500' : 'text-red-500',
                  )}
                >
                  {agentCollecting}
                </span>
                <span className="text-xs text-[#5A6478]">/{agentTotal}</span>
              </div>
              <span className="text-xs whitespace-nowrap text-[#8B97AD]">수집</span>
            </div>
          )}

          <StatCell
            label="로그 Critical"
            value={summary.total_log_critical}
            icon={FileWarning}
            color="text-red-500"
            glowClass={GLOW_RED}
            borderClass="border-red-500"
            bgClass="bg-[rgba(239,68,68,0.06)]"
          />
          <StatCell
            label="로그 Warning"
            value={summary.total_log_warning}
            icon={AlertTriangle}
            color="text-yellow-500"
            glowClass={GLOW_YELLOW}
            borderClass="border-yellow-500"
            bgClass="bg-[rgba(245,158,11,0.04)]"
          />
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
