import { AlertTriangle } from 'lucide-react'

interface CriticalTrendBannerProps {
  count: number
}

export function CriticalTrendBanner({ count }: CriticalTrendBannerProps) {
  if (count === 0) return null

  return (
    <div
      role="alert"
      className="border-critical border-l-critical bg-critical-card-bg mb-4 flex items-center gap-3 rounded-sm border border-l-4 px-4 py-3"
    >
      <AlertTriangle className="text-critical h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <p className="text-critical-text text-sm font-medium">
        임박한 장애 예측 {count}건이 감지되었습니다. 즉시 확인이 필요합니다.
      </p>
    </div>
  )
}
