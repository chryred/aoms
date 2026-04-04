import { AlertTriangle } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function CriticalBanner() {
  const count = useUiStore((s) => s.criticalCount)
  if (count === 0) return null

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2
                 bg-[#EF4444] py-2 px-4 text-white text-sm font-semibold tracking-wide"
    >
      <AlertTriangle className="w-4 h-4" />
      미확인 Critical 알림 {count}건 — 즉시 확인이 필요합니다
    </div>
  )
}
