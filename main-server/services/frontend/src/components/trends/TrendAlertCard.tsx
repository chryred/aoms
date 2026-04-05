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
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={alert.llm_severity} />
          <span className="font-semibold text-[#E2E8F2]">{systemLabel}</span>
        </div>
        <span className="ml-2 text-xs whitespace-nowrap text-[#8B97AD]">
          {formatRelative(alert.hour_bucket)}
        </span>
      </div>

      {/* metric_group + collector_type */}
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-[rgba(0,212,255,0.10)] px-2 py-0.5 text-xs text-[#00D4FF]">
          {alert.metric_group}
        </span>
        <span className="text-xs text-[#8B97AD]">{alert.collector_type}</span>
      </div>

      {/* llm_prediction */}
      <p className="mt-2 text-sm whitespace-pre-wrap text-[#E2E8F2]">{alert.llm_prediction}</p>

      {/* llm_summary */}
      {alert.llm_summary && (
        <p className="mt-1 line-clamp-3 text-sm text-[#8B97AD]">{alert.llm_summary}</p>
      )}

      {/* Footer */}
      <div className="mt-3">
        <Link
          to={`/dashboard/${alert.system_id}`}
          className="rounded text-sm text-[#00D4FF] hover:underline focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127] focus:outline-none"
        >
          시스템 상세 보기
        </Link>
      </div>
    </NeuCard>
  )
}
