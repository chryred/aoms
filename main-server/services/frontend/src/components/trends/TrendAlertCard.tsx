import { Link } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { ROUTES } from '@/constants/routes'
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
          <span className="text-text-primary font-semibold">{systemLabel}</span>
        </div>
        <span className="text-text-secondary ml-2 text-xs whitespace-nowrap">
          {formatRelative(alert.hour_bucket)}
        </span>
      </div>

      {/* metric_group + collector_type */}
      <div className="mb-2 flex items-center gap-2">
        <span className="bg-accent-muted text-accent rounded px-2 py-0.5 text-xs">
          {alert.metric_group}
        </span>
        <span className="text-text-secondary text-xs">{alert.collector_type}</span>
      </div>

      {/* llm_prediction */}
      <p className="text-text-primary mt-2 text-sm whitespace-pre-wrap">{alert.llm_prediction}</p>

      {/* llm_summary */}
      {alert.llm_summary && (
        <p className="text-text-secondary mt-1 line-clamp-3 text-sm">{alert.llm_summary}</p>
      )}

      {/* Footer */}
      <div className="mt-3">
        <Link
          to={ROUTES.systemDetail(alert.system_id)}
          className="text-accent focus:ring-accent focus:ring-offset-bg-base rounded text-sm hover:underline focus:ring-1 focus:ring-offset-2 focus:outline-none"
        >
          시스템 상세 보기
        </Link>
      </div>
    </NeuCard>
  )
}
