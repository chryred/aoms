import { useState, useEffect } from 'react'
import { useUiStore } from '@/store/uiStore'

export function useBannerVisible() {
  const criticalCount = useUiStore((s) => s.criticalCount)
  const bannerSnoozedUntil = useUiStore((s) => s.bannerSnoozedUntil)
  const [, setTick] = useState(0)

  useEffect(() => {
    const remaining = bannerSnoozedUntil - Date.now()
    if (remaining <= 0) return
    const t = setTimeout(() => setTick((n) => n + 1), remaining + 100)
    return () => clearTimeout(t)
  }, [bannerSnoozedUntil])

  return criticalCount > 0 && Date.now() >= bannerSnoozedUntil
}
