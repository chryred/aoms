import { memo } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, TrendingUp, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import type { DashboardSummary } from '@/hooks/queries/useDashboardHealth'

interface DashboardSummaryProps {
  summary: DashboardSummary
}

export const DashboardSummaryStats = memo(function DashboardSummaryStats({
  summary,
}: DashboardSummaryProps) {
  const stats = [
    {
      label: '위험',
      value: summary.critical_systems,
      total: summary.total_systems,
      icon: AlertCircle,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30',
    },
    {
      label: '경고',
      value: summary.warning_systems,
      total: summary.total_systems,
      icon: AlertTriangle,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      borderColor: 'border-yellow-500/30',
    },
    {
      label: '정상',
      value: summary.normal_systems,
      total: summary.total_systems,
      icon: CheckCircle,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/30',
    },
    {
      label: '예방 패턴',
      value: summary.proactive_systems ?? 0,
      total: undefined,
      icon: ShieldAlert,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
      borderColor: 'border-purple-500/30',
    },
    {
      label: '메트릭 알림',
      value: summary.total_metric_alerts,
      total: undefined,
      icon: TrendingUp,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {stats.map((stat) => {
        const Icon = stat.icon
        const percentage =
          stat.total && summary.total_systems > 0
            ? Math.round((stat.value / stat.total) * 100)
            : undefined

        return (
          <div
            key={stat.label}
            className="transition-all duration-150 hover:shadow-lg"
          >
            <NeuCard
              className={cn(
                'border-l-4 relative overflow-hidden transition-all duration-150',
                stat.borderColor
              )}
            >
            {/* 배경 액센트 */}
            <div className={cn('absolute inset-0 opacity-5', stat.bgColor)} />

            <div className="relative flex flex-col gap-3">
              {/* 아이콘 + 레이블 */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8B97AD] uppercase">
                  {stat.label}
                </span>
                <Icon className={cn('h-4 w-4', stat.color)} />
              </div>

              {/* 메인 값 */}
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-2xl sm:text-3xl font-bold text-[#E2E8F2]">
                  {stat.value}
                </span>
                {stat.total !== undefined && (
                  <span className="text-xs sm:text-sm text-[#8B97AD]">
                    / {stat.total}
                    {percentage !== undefined && (
                      <span className="ml-1 font-semibold text-[#A8B5C3]">
                        {percentage}%
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            </NeuCard>
          </div>
        )
      })}
    </div>
  )
})

// 하단 추가 통계
export const DashboardLogAnalysisSummary = memo(function DashboardLogAnalysisSummary({
  summary,
}: DashboardSummaryProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="transition-all duration-150 hover:shadow-lg">
        <NeuCard className="border-l-4 border-red-500/30 transition-all duration-150">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-[#8B97AD] uppercase">
                로그분석 Critical
              </span>
              <span className="text-2xl font-bold text-red-500">
                {summary.total_log_critical}
              </span>
            </div>
            <AlertCircle className="h-5 w-5 text-red-500 opacity-20" />
          </div>
        </NeuCard>
      </div>

      <div className="transition-all duration-150 hover:shadow-lg">
        <NeuCard className="border-l-4 border-yellow-500/30 transition-all duration-150">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-[#8B97AD] uppercase">
                로그분석 Warning
              </span>
              <span className="text-2xl font-bold text-yellow-500">
                {summary.total_log_warning}
              </span>
            </div>
            <AlertTriangle className="h-5 w-5 text-yellow-500 opacity-20" />
          </div>
        </NeuCard>
      </div>
    </div>
  )
})
