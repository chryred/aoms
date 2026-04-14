import { AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'
import { ROUTES } from '@/constants/routes'

export function CriticalBanner() {
  const count = useUiStore((s) => s.criticalCount)
  const navigate = useNavigate()
  if (count === 0) return null

  const goToCriticalList = () => {
    navigate(`${ROUTES.ALERTS}?severity=critical&acknowledged=unack`)
  }

  return (
    <button
      type="button"
      role="alert"
      onClick={goToCriticalList}
      aria-label={`미확인 Critical 알림 ${count}건 — 클릭하여 이력 보기`}
      className="bg-critical hover:bg-critical/90 focus-visible:ring-accent fixed inset-x-0 top-0 z-50 flex cursor-pointer items-center justify-center gap-2 px-4 py-2 text-sm font-semibold tracking-wide text-white transition-colors focus-visible:ring-1 focus-visible:outline-none"
    >
      <AlertTriangle className="h-4 w-4" />
      미확인 Critical 알림 {count}건 — 즉시 확인이 필요합니다
    </button>
  )
}
