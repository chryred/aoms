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

export function AggregationCard({ systemId, displayName, aggregation, onDrillDown }: AggregationCardProps) {
  const severity = llmSeverityToCardSeverity(aggregation.llm_severity)
  const metricSummary = summarizeMetrics(aggregation.metrics_json, aggregation.collector_type)

  return (
    <NeuCard severity={severity}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-semibold text-[#1A1F2E]">{displayName}</p>
          <p className="text-xs text-[#4A5568]">{getBucket(aggregation)}</p>
        </div>
        {aggregation.llm_severity && <SeverityBadge severity={aggregation.llm_severity} />}
      </div>

      {metricSummary && (
        <p className="text-xs text-[#4A5568] mb-2 font-mono">{metricSummary}</p>
      )}

      {aggregation.llm_summary && (
        <p className="text-sm text-[#1A1F2E] whitespace-pre-wrap line-clamp-3 mb-1">
          {aggregation.llm_summary}
        </p>
      )}
      {aggregation.llm_trend && (
        <p className="text-xs text-[#4A5568] italic mb-3">{aggregation.llm_trend}</p>
      )}

      <Link
        to={`/dashboard/${systemId}`}
        onClick={onDrillDown}
        className="text-xs text-[#6366F1] hover:underline font-medium"
      >
        상세 보기 →
      </Link>
    </NeuCard>
  )
}
