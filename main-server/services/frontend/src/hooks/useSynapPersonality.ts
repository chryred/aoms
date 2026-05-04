import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'
import { SYNAP_MESSAGES } from '@/constants/synapMessages'
import { ROUTES } from '@/constants/routes'

const MIN_INTERVAL_MS = 10 * 60 * 1000 // 10분 쿨다운
const IDLE_TIMEOUT_MS = 3 * 60 * 1000 // 3분 비활동
const PERIODIC_MS = 10 * 60 * 1000 // 10분마다 시간대 체크
const PAGE_TRIGGER_DELAY_MS = 2000 // 페이지 진입 후 2초 딜레이

type TimeCategory = 'morning' | 'afternoon' | 'evening' | 'night'

function getTimeCategory(): TimeCategory {
  const h = new Date().getHours()
  if (h >= 6 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
}

export function useSynapPersonality() {
  const [message, setMessage] = useState<string | null>(null)

  const lastShownAt = useRef<number>(0)
  const seenIndices = useRef<Record<string, Set<number>>>({})
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevCriticalCount = useRef<number>(-1)
  const shownTimeCategories = useRef<Set<string>>(new Set())

  const criticalCount = useUiStore((s) => s.criticalCount)
  const { pathname } = useLocation()

  const canShow = useCallback((): boolean => {
    return Date.now() - lastShownAt.current >= MIN_INTERVAL_MS
  }, [])

  const pick = useCallback((category: string, pool: string[]): string | null => {
    if (!seenIndices.current[category]) {
      seenIndices.current[category] = new Set()
    }
    const seen = seenIndices.current[category]
    if (seen.size >= pool.length) seen.clear()
    const available = pool.map((_, i) => i).filter((i) => !seen.has(i))
    if (available.length === 0) return null
    const idx = available[Math.floor(Math.random() * available.length)]
    seen.add(idx)
    return pool[idx]
  }, [])

  const show = useCallback((msg: string) => {
    setMessage(msg)
    lastShownAt.current = Date.now()
  }, [])

  const dismiss = useCallback(() => {
    setMessage(null)
  }, [])

  // Critical 알림 발생 시 즉시 (쿨다운 무시)
  useEffect(() => {
    if (prevCriticalCount.current >= 0 && criticalCount > prevCriticalCount.current) {
      const msg = pick('critical', SYNAP_MESSAGES.critical)
      if (msg) show(msg)
    }
    prevCriticalCount.current = criticalCount
  }, [criticalCount, pick, show])

  // 페이지 진입 트리거 (2초 딜레이)
  useEffect(() => {
    if (!canShow()) return undefined

    let category: string | null = null
    let pool: string[] | null = null

    if (pathname.startsWith(ROUTES.SEARCH)) {
      category = 'page_search'
      pool = SYNAP_MESSAGES.page_search
    } else if (pathname.startsWith(ROUTES.REPORTS)) {
      category = 'page_report'
      pool = SYNAP_MESSAGES.page_report
    } else if (pathname.startsWith(ROUTES.KNOWLEDGE)) {
      category = 'page_knowledge'
      pool = SYNAP_MESSAGES.page_knowledge
    }

    if (!category || !pool) return undefined

    const cat = category
    const p = pool
    const timer = setTimeout(() => {
      if (canShow()) {
        const msg = pick(cat, p)
        if (msg) show(msg)
      }
    }, PAGE_TRIGGER_DELAY_MS)

    return () => clearTimeout(timer)
  }, [pathname, canShow, pick, show])

  // 유휴 트리거 (3분 비활동)
  useEffect(() => {
    const resetIdle = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        if (canShow()) {
          const msg = pick('idle', SYNAP_MESSAGES.idle)
          if (msg) show(msg)
        }
      }, IDLE_TIMEOUT_MS)
    }

    window.addEventListener('mousemove', resetIdle, { passive: true })
    window.addEventListener('keydown', resetIdle, { passive: true })
    window.addEventListener('scroll', resetIdle, { passive: true })
    resetIdle()

    return () => {
      window.removeEventListener('mousemove', resetIdle)
      window.removeEventListener('keydown', resetIdle)
      window.removeEventListener('scroll', resetIdle)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [canShow, pick, show])

  // 시간대별 주기 트리거
  useEffect(() => {
    const check = () => {
      if (!canShow()) return
      const tc = getTimeCategory()
      if (shownTimeCategories.current.has(tc)) return
      const msg = pick(tc, SYNAP_MESSAGES[tc])
      if (msg) {
        show(msg)
        shownTimeCategories.current.add(tc)
      }
    }

    // 첫 체크는 30초 후 (페이지 로드 직후 스팸 방지)
    const initial = setTimeout(check, 30 * 1000)
    const periodic = setInterval(check, PERIODIC_MS)

    return () => {
      clearTimeout(initial)
      clearInterval(periodic)
    }
  }, [canShow, pick, show])

  return { message, dismiss, isSpeaking: message !== null }
}
