import { AlertTriangle } from 'lucide-react'

interface CriticalTrendBannerProps {
  count: number
}

export function CriticalTrendBanner({ count }: CriticalTrendBannerProps) {
  if (count === 0) return null

  return (
    <div
      role="alert"
      className="rounded-xl bg-[rgba(239,68,68,0.08)] border border-[#EF4444]
                 border-l-4 border-l-[#EF4444] px-4 py-3 flex items-center gap-3 mb-4"
    >
      <AlertTriangle className="w-5 h-5 text-[#EF4444] flex-shrink-0" aria-hidden="true" />
      <p className="text-[#F87171] text-sm font-medium">
        임박한 장애 예측 {count}건이 감지되었습니다. 즉시 확인이 필요합니다.
      </p>
    </div>
  )
}
