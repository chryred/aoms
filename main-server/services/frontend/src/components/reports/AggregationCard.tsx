import { NeuCard } from '@/components/neumorphic/NeuCard'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { summarizeMetrics, llmSeverityToCardSeverity, formatKST } from '@/lib/utils'
import type { DailyAggregation, WeeklyAggregation, MonthlyAggregation } from '@/types/aggregation'

interface AggregationCardProps {
  systemId: number
  systemName: string
  displayName: string
  aggregation: DailyAggregation | WeeklyAggregation | MonthlyAggregation
  onDrillDown?: () => void
}

function getBucket(agg: DailyAggregation | WeeklyAggregation | MonthlyAggregation): string {
  if ('day_bucket' in agg) return formatKST(agg.day_bucket, 'date')
  if ('week_start' in agg) return `${formatKST(agg.week_start, 'date')} 주`
  if ('period_start' in agg) return formatKST(agg.period_start, 'date')
  return '-'
}

export function AggregationCard({
  systemId,
  displayName,
  aggregation,
  onDrillDown,
}: AggregationCardProps) {
  const severity = llmSeverityToCardSeverity(aggregation.llm_severity)
  const metricSummary = summarizeMetrics(aggregation.metrics_json, aggregation.collector_type)

  return (
    <NeuCard severity={severity}>
      <div className="mb-2 flex items-start justify-between">
        <div>
          <p className="text-text-primary font-semibold">{displayName}</p>
          <p className="text-text-secondary text-xs">{getBucket(aggregation)}</p>
        </div>
        {aggregation.llm_severity && <SeverityBadge severity={aggregation.llm_severity} />}
      </div>

      {metricSummary.length > 0 && (
        <div className="border-border mb-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2">
          {metricSummary.map(({ key, value }) => (
            <div key={key} className="flex flex-col">
              <span className="text-text-secondary text-xs leading-tight">{key}</span>
              <span className="text-text-primary tabular-nums text-sm font-semibold leading-tight">
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {aggregation.llm_summary && (
        <p className="text-text-primary mb-1 line-clamp-3 text-sm whitespace-pre-wrap">
          {aggregation.llm_summary}
        </p>
      )}
      {aggregation.llm_trend && (
        <p className="text-text-secondary mb-3 text-xs italic">{aggregation.llm_trend}</p>
      )}

      <Link
        to={ROUTES.systemDetail(systemId)}
        onClick={onDrillDown}
        aria-label={`${displayName} 상세 보기`}
        className="text-accent text-xs font-medium hover:underline"
      >
        상세 보기 <span aria-hidden="true">→</span>
      </Link>
    </NeuCard>
  )
}
