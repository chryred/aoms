import { AlertTriangle } from 'lucide-react'

interface CriticalTrendBannerProps {
  count: number
}

export function CriticalTrendBanner({ count }: CriticalTrendBannerProps) {
  if (count === 0) return null

  return (
    <div
      role="alert"
      className="mb-4 flex items-center gap-3 rounded-sm border border-l-4 border-[#EF4444] border-l-[#EF4444] bg-[rgba(239,68,68,0.08)] px-4 py-3"
    >
      <AlertTriangle className="h-5 w-5 flex-shrink-0 text-[#EF4444]" aria-hidden="true" />
      <p className="text-sm font-medium text-[#F87171]">
        임박한 장애 예측 {count}건이 감지되었습니다. 즉시 확인이 필요합니다.
      </p>
    </div>
  )
}
