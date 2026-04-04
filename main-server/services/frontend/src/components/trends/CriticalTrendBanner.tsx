import { AlertTriangle } from 'lucide-react'

interface CriticalTrendBannerProps {
  count: number
}

export function CriticalTrendBanner({ count }: CriticalTrendBannerProps) {
  if (count === 0) return null

  return (
    <div
      role="alert"
      className="rounded-xl bg-[rgba(220,38,38,0.08)] border border-[#DC2626]
                 border-l-4 border-l-[#DC2626] px-4 py-3 flex items-center gap-3 mb-4"
    >
      <AlertTriangle className="w-5 h-5 text-[#DC2626] flex-shrink-0" aria-hidden="true" />
      <p className="text-[#DC2626] text-sm font-medium">
        임박한 장애 예측 {count}건이 감지되었습니다. 즉시 확인이 필요합니다.
      </p>
    </div>
  )
}
