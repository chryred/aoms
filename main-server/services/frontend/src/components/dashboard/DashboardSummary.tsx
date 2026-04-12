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

interface StatItem {
  label: string
  value: number
  total?: number
  icon: React.ElementType
  color: string
  accentBorder?: string
}

/**
 * Compact stat bar — 1행으로 전체 상태를 한눈에 파악.
 * Bloomberg Terminal 스타일의 dense 정보 표시.
 */
export const DashboardSummaryStats = memo(function DashboardSummaryStats({
  summary,
  agentSummary,
}: DashboardSummaryProps & { agentSummary?: AgentHealthSummary }) {
  const stats: StatItem[] = [
    {
      label: '위험',
      value: summary.critical_systems,
      total: summary.total_systems,
      icon: AlertCircle,
      color: 'text-red-500',
      accentBorder: summary.critical_systems > 0 ? 'border-red-500/40' : undefined,
    },
    {
      label: '경고',
      value: summary.warning_systems,
      total: summary.total_systems,
      icon: AlertTriangle,
      color: 'text-yellow-500',
      accentBorder: summary.warning_systems > 0 ? 'border-yellow-500/40' : undefined,
    },
    {
      label: '정상',
      value: summary.normal_systems,
      total: summary.total_systems,
      icon: CheckCircle,
      color: 'text-green-500',
    },
    {
      label: '예방',
      value: summary.proactive_systems ?? 0,
      icon: ShieldAlert,
      color: 'text-purple-400',
      accentBorder: (summary.proactive_systems ?? 0) > 0 ? 'border-purple-500/40' : undefined,
    },
    {
      label: '알림',
      value: summary.total_metric_alerts,
      icon: TrendingUp,
      color: 'text-blue-400',
      accentBorder: summary.total_metric_alerts > 0 ? 'border-blue-500/40' : undefined,
    },
  ]

  // 에이전트 상태
  const agentCollecting = agentSummary?.collecting ?? 0
  const agentTotal = agentSummary?.total ?? 0
  const agentAllOk = agentTotal > 0 && agentCollecting === agentTotal
  const agentHasStale = (agentSummary?.stale ?? 0) > 0

  return (
    <div className="flex flex-wrap gap-px rounded-sm border border-[#2B2F37] bg-[#2B2F37] overflow-hidden">
      {stats.map((stat) => {
        const Icon = stat.icon
        const isZero = stat.value === 0
        return (
          <div
            key={stat.label}
            className={cn(
              'flex min-w-[100px] flex-1 items-center gap-2.5 bg-[#1E2127] px-3.5 py-3',
              stat.accentBorder && 'border-b-2',
              stat.accentBorder,
            )}
          >
            <Icon className={cn('h-3.5 w-3.5 flex-shrink-0', isZero ? 'text-[#5A6478]' : stat.color)} />
            <div className="flex items-baseline gap-1.5">
              <span className={cn('text-lg font-bold tabular-nums', isZero ? 'text-[#5A6478]' : stat.color)}>
                {stat.value}
              </span>
              {stat.total !== undefined && (
                <span className="text-xs text-[#5A6478]">/{stat.total}</span>
              )}
            </div>
            <span className="whitespace-nowrap text-xs text-[#8B97AD]">{stat.label}</span>
          </div>
        )
      })}

      {/* 에이전트 */}
      {agentTotal > 0 && (
        <div
          className={cn(
            'flex min-w-[100px] flex-1 items-center gap-2.5 bg-[#1E2127] px-3.5 py-3',
            agentHasStale && 'border-b-2 border-red-500/40',
          )}
        >
          <Radio className={cn('h-3.5 w-3.5 flex-shrink-0', agentAllOk ? 'text-green-500' : agentHasStale ? 'text-red-500' : 'text-yellow-500')} />
          <div className="flex items-baseline gap-1.5">
            <span className={cn('text-lg font-bold tabular-nums', agentAllOk ? 'text-green-500' : agentHasStale ? 'text-red-500' : 'text-yellow-500')}>
              {agentCollecting}
            </span>
            <span className="text-xs text-[#5A6478]">/{agentTotal}</span>
          </div>
          <span className="whitespace-nowrap text-xs text-[#8B97AD]">에이전트</span>
        </div>
      )}

      {/* 로그분석 통계 — 통합 */}
      <div
        className={cn(
          'flex min-w-[100px] flex-1 items-center gap-2.5 bg-[#1E2127] px-3.5 py-3',
          summary.total_log_critical > 0 && 'border-b-2 border-red-500/40',
        )}
      >
        <FileWarning className={cn('h-3.5 w-3.5 flex-shrink-0', summary.total_log_critical > 0 ? 'text-red-500' : 'text-[#5A6478]')} />
        <div className="flex items-baseline gap-1.5">
          <span className={cn('text-lg font-bold tabular-nums', summary.total_log_critical > 0 ? 'text-red-500' : 'text-[#5A6478]')}>
            {summary.total_log_critical}
          </span>
        </div>
        <span className="text-xs text-[#8B97AD]">로그C</span>
      </div>
      <div
        className={cn(
          'flex min-w-[100px] flex-1 items-center gap-2.5 bg-[#1E2127] px-3.5 py-3',
          summary.total_log_warning > 0 && 'border-b-2 border-yellow-500/40',
        )}
      >
        <AlertTriangle className={cn('h-3.5 w-3.5 flex-shrink-0', summary.total_log_warning > 0 ? 'text-yellow-500' : 'text-[#5A6478]')} />
        <div className="flex items-baseline gap-1.5">
          <span className={cn('text-lg font-bold tabular-nums', summary.total_log_warning > 0 ? 'text-yellow-500' : 'text-[#5A6478]')}>
            {summary.total_log_warning}
          </span>
        </div>
        <span className="text-xs text-[#8B97AD]">로그W</span>
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
