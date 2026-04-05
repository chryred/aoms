import { NeuCard } from '@/components/neumorphic/NeuCard'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { Link } from 'react-router-dom'
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
          <p className="font-semibold text-[#E2E8F2]">{displayName}</p>
          <p className="text-xs text-[#8B97AD]">{getBucket(aggregation)}</p>
        </div>
        {aggregation.llm_severity && <SeverityBadge severity={aggregation.llm_severity} />}
      </div>

      {metricSummary && <p className="mb-2 font-mono text-xs text-[#8B97AD]">{metricSummary}</p>}

      {aggregation.llm_summary && (
        <p className="mb-1 line-clamp-3 text-sm whitespace-pre-wrap text-[#E2E8F2]">
          {aggregation.llm_summary}
        </p>
      )}
      {aggregation.llm_trend && (
        <p className="mb-3 text-xs text-[#8B97AD] italic">{aggregation.llm_trend}</p>
      )}

      <Link
        to={`/dashboard/${systemId}`}
        onClick={onDrillDown}
        className="text-xs font-medium text-[#00D4FF] hover:underline"
      >
        상세 보기 →
      </Link>
    </NeuCard>
  )
}
