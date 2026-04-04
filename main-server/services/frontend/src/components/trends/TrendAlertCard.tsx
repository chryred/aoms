import { Link } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { formatRelative } from '@/lib/utils'
import type { TrendAlert } from '@/types/aggregation'

interface TrendAlertCardProps {
  alert: TrendAlert & { display_name?: string; system_name?: string }
}

export function TrendAlertCard({ alert }: TrendAlertCardProps) {
  const systemLabel = alert.display_name ?? alert.system_name ?? `시스템 #${alert.system_id}`

  return (
    <NeuCard
      severity={
        alert.llm_severity === 'critical'
          ? 'critical'
          : alert.llm_severity === 'warning'
            ? 'warning'
            : undefined
      }
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={alert.llm_severity} />
          <span className="font-semibold text-[#1A1F2E]">{systemLabel}</span>
        </div>
        <span className="text-xs text-[#4A5568] whitespace-nowrap ml-2">
          {formatRelative(alert.hour_bucket)}
        </span>
      </div>

      {/* metric_group + collector_type */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs bg-[rgba(99,102,241,0.1)] text-[#4338CA] px-2 py-0.5 rounded">
          {alert.metric_group}
        </span>
        <span className="text-xs text-[#4A5568]">{alert.collector_type}</span>
      </div>

      {/* llm_prediction */}
      <p className="whitespace-pre-wrap text-sm text-[#1A1F2E] mt-2">{alert.llm_prediction}</p>

      {/* llm_summary */}
      {alert.llm_summary && (
        <p className="text-sm text-[#4A5568] line-clamp-3 mt-1">{alert.llm_summary}</p>
      )}

      {/* Footer */}
      <div className="mt-3">
        <Link
          to={`/dashboard/${alert.system_id}`}
          className="text-[#6366F1] text-sm hover:underline focus:outline-none focus:ring-2 focus:ring-[#6366F1] focus:ring-offset-2 rounded"
        >
          시스템 상세 보기
        </Link>
      </div>
    </NeuCard>
  )
}
