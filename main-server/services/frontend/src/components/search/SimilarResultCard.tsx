import { Link } from 'react-router-dom'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { ROUTES } from '@/constants/routes'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { formatKST, formatPeriodLabel } from '@/lib/utils'
import type { SimilarSearchResult, HourlyPatternPayload, AggSummaryPayload } from '@/types/search'
import type { LlmSeverity } from '@/types/aggregation'
import type { ReportType } from '@/types/report'
import { cn } from '@/lib/utils'

interface SimilarResultCardProps {
  result: SimilarSearchResult
  collection: string
  systemDisplayName?: string
}

function ScoreBadge({ score }: { score: number }) {
  const label = `${parseFloat((score * 100).toFixed(1))}%`
  const className =
    score >= 0.95
      ? 'bg-normal-bg text-normal-text'
      : score >= 0.85
        ? 'bg-accent-muted text-accent'
        : 'bg-warning-bg text-warning-text'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        className,
      )}
    >
      유사도 {label}
    </span>
  )
}

function isHourly(payload: SimilarSearchResult['payload']): payload is HourlyPatternPayload {
  return 'hour_bucket' in payload
}

export function SimilarResultCard({ result, collection, systemDisplayName }: SimilarResultCardProps) {
  const { score, payload } = result
  const displayName = systemDisplayName ?? payload.system_name
  const isHourlyPattern = collection === 'metric_hourly_patterns' && isHourly(payload)

  const severity = isHourlyPattern
    ? ((payload as HourlyPatternPayload).llm_severity as LlmSeverity)
    : ((payload as AggSummaryPayload).dominant_severity as LlmSeverity)

  const summaryText = isHourlyPattern
    ? (payload as HourlyPatternPayload).summary_text
    : (payload as AggSummaryPayload).summary_text

  const periodLabel = isHourlyPattern
    ? formatKST((payload as HourlyPatternPayload).hour_bucket, 'datetime')
    : formatPeriodLabel(
        (payload as AggSummaryPayload).period_type as ReportType,
        (payload as AggSummaryPayload).period_start,
      )

  return (
    <NeuCard
      severity={
        severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : undefined
      }
      className="flex h-full flex-col"
    >
      {/* Header: 시스템명 + 기간 (left) | 유사도 + 심각도 (right) */}
      <div className="mb-3 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <span className="text-text-primary text-sm font-semibold">{displayName}</span>
          <span className="text-text-secondary ml-2 text-xs">{periodLabel}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ScoreBadge score={score} />
          <SeverityBadge severity={severity} />
        </div>
      </div>

      {/* collector / metric badges (hourly only) */}
      {isHourlyPattern && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <span className="bg-accent-muted text-accent rounded-sm px-2 py-0.5 text-xs">
            {(payload as HourlyPatternPayload).metric_group}
          </span>
          <span className="bg-muted-bg text-text-secondary rounded-sm px-2 py-0.5 text-xs">
            {(payload as HourlyPatternPayload).collector_type}
          </span>
        </div>
      )}

      {/* LLM summary */}
      <p className="text-text-primary break-words text-sm leading-relaxed whitespace-pre-wrap">
        {summaryText}
      </p>

      {/* llm_prediction (hourly only) */}
      {isHourlyPattern && (payload as HourlyPatternPayload).llm_prediction && (
        <p className="text-text-secondary mt-2 break-words text-sm leading-relaxed whitespace-pre-wrap italic">
          {(payload as HourlyPatternPayload).llm_prediction}
        </p>
      )}

      {/* Footer */}
      <div className="border-border mt-auto border-t pt-3">
        <Link
          to={`${ROUTES.ALERTS}?system_id=${payload.system_id}`}
          aria-label={`${displayName} 관련 알림 이력`}
          className="text-accent focus:ring-accent focus:ring-offset-bg-base rounded-sm text-sm hover:underline focus:ring-1 focus:ring-offset-2 focus:outline-none"
        >
          관련 알림 이력
        </Link>
      </div>
    </NeuCard>
  )
}
