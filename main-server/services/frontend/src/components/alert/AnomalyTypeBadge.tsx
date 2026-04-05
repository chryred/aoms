import { cn } from '@/lib/utils'
import { anomalyColor } from '@/lib/utils'
import type { AnomalyType } from '@/types/alert'

const LABELS: Record<AnomalyType, string> = {
  new: '신규',
  related: '유사',
  recurring: '반복',
  duplicate: '중복',
}

interface AnomalyTypeBadgeProps {
  type: AnomalyType | null
  score?: number | null
}

export function AnomalyTypeBadge({ type, score }: AnomalyTypeBadgeProps) {
  if (!type) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        anomalyColor(type),
      )}
    >
      {LABELS[type]}
      {score !== null && score !== undefined && (
        <span className="opacity-70">({Math.round(score * 100)}%)</span>
      )}
    </span>
  )
}
