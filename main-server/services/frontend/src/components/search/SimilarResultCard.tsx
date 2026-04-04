import { Link } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { formatKST, formatPeriodLabel } from '@/lib/utils'
import type { SimilarSearchResult, HourlyPatternPayload, AggSummaryPayload } from '@/types/search'
import type { LlmSeverity } from '@/types/aggregation'
import type { ReportType } from '@/types/report'
import { cn } from '@/lib/utils'

interface SimilarResultCardProps {
  result: SimilarSearchResult
  collection: string
}

function ScoreBadge({ score }: { score: number }) {
  const label = `${(score * 100).toFixed(1)}%`
  const className =
    score >= 0.95
      ? 'bg-[rgba(34,197,94,0.15)] text-[#4ADE80]'
      : score >= 0.85
        ? 'bg-[rgba(0,212,255,0.12)] text-[#00D4FF]'
        : 'bg-[rgba(245,158,11,0.12)] text-[#FCD34D]'

  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>
      유사도 {label}
    </span>
  )
}

function isHourly(payload: SimilarSearchResult['payload']): payload is HourlyPatternPayload {
  return 'hour_bucket' in payload
}

export function SimilarResultCard({ result, collection }: SimilarResultCardProps) {
  const { score, payload } = result
  const isHourlyPattern = collection === 'metric_hourly_patterns' && isHourly(payload)

  const severity = isHourlyPattern
    ? (payload as HourlyPatternPayload).llm_severity as LlmSeverity
    : (payload as AggSummaryPayload).dominant_severity as LlmSeverity

  const summaryText = isHourlyPattern
    ? (payload as HourlyPatternPayload).summary_text
    : (payload as AggSummaryPayload).summary_text

  const periodLabel = isHourlyPattern
    ? formatKST((payload as HourlyPatternPayload).hour_bucket, 'datetime')
    : formatPeriodLabel(
        (payload as AggSummaryPayload).period_type as ReportType,
        (payload as AggSummaryPayload).period_start
      )

  return (
    <NeuCard severity={severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : undefined}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <ScoreBadge score={score} />
        <SeverityBadge severity={severity} />
      </div>

      {/* System + period */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-semibold text-[#E2E8F2]">{payload.system_name}</span>
        <span className="text-sm text-[#8B97AD]">{periodLabel}</span>
      </div>

      {/* collector / metric badges (hourly only) */}
      {isHourlyPattern && (
        <div className="flex gap-2 mb-2">
          <span className="text-xs bg-[rgba(0,212,255,0.10)] text-[#00D4FF] px-2 py-0.5 rounded">
            {(payload as HourlyPatternPayload).metric_group}
          </span>
          <span className="text-xs text-[#8B97AD]">
            {(payload as HourlyPatternPayload).collector_type}
          </span>
        </div>
      )}

      {/* LLM summary */}
      <p className="whitespace-pre-wrap text-sm text-[#E2E8F2] mb-2">{summaryText}</p>

      {/* llm_prediction (hourly only) */}
      {isHourlyPattern && (payload as HourlyPatternPayload).llm_prediction && (
        <p className="whitespace-pre-wrap text-sm italic text-[#8B97AD] mb-3">
          {(payload as HourlyPatternPayload).llm_prediction}
        </p>
      )}

      {/* Footer link */}
      <Link
        to={`/alerts?system_id=${payload.system_id}`}
        className="text-[#00D4FF] text-sm hover:underline focus:outline-none focus:ring-2 focus:ring-[#00D4FF] focus:ring-offset-2 focus:ring-offset-[#1E2127] rounded"
      >
        관련 알림 이력
      </Link>
    </NeuCard>
  )
}
