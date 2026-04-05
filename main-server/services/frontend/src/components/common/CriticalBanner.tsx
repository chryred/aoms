import { AlertTriangle } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function CriticalBanner() {
  const count = useUiStore((s) => s.criticalCount)
  if (count === 0) return null

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-[#EF4444] px-4 py-2 text-sm font-semibold tracking-wide text-white"
    >
      <AlertTriangle className="h-4 w-4" />
      미확인 Critical 알림 {count}건 — 즉시 확인이 필요합니다
    </div>
  )
}
