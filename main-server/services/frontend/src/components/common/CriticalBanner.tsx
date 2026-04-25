import { AlertTriangle, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'
import { ROUTES } from '@/constants/routes'

export function CriticalBanner() {
  const count = useUiStore((s) => s.criticalCount)
  const snoozedUntil = useUiStore((s) => s.bannerSnoozedUntil)
  const snoozeBanner = useUiStore((s) => s.snoozeBanner)
  const navigate = useNavigate()

  if (count === 0 || Date.now() < snoozedUntil) return null

  const goToCriticalList = () => {
    navigate(`${ROUTES.ALERTS}?severity=critical&acknowledged=unack`)
  }

  return (
    <div
      role="region"
      aria-label={`미확인 Critical 알림 ${count}건`}
      className="bg-surface border-critical fixed inset-x-0 top-0 z-50 flex border-b-2"
    >
      <button
        type="button"
        onClick={goToCriticalList}
        aria-label={`미확인 Critical 알림 ${count}건 — 클릭하여 이력 보기`}
        className="focus-visible:ring-accent text-critical-text hover:bg-bg-base flex flex-1 cursor-pointer items-center justify-center gap-2 overflow-hidden px-4 py-3 text-sm font-semibold tracking-wide transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">미확인 Critical 알림 {count}건 — 즉시 확인이 필요합니다</span>
      </button>
      <button
        type="button"
        onClick={snoozeBanner}
        aria-label="30분 동안 배너 숨기기"
        className="focus-visible:ring-accent text-text-secondary hover:text-critical-text hover:bg-bg-base shrink-0 px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
