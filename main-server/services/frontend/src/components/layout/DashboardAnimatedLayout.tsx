import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

/**
 * Dashboard ↔ SystemDetail 라우트 전환 시 슬라이드 애니메이션을 적용하는 레이아웃.
 *
 * - 대시보드 → 상세: 오른쪽에서 슬라이드 인
 * - 상세 → 대시보드: 왼쪽에서 슬라이드 인
 */
export function DashboardAnimatedLayout() {
  const location = useLocation()
  const prevPathRef = useRef(location.pathname)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prev = prevPathRef.current
    const curr = location.pathname

    if (prev !== curr && containerRef.current) {
      const wasDashboard = prev === '/dashboard'
      const isDashboard = curr === '/dashboard'
      const wasDetail = prev.startsWith('/dashboard/') && !wasDashboard
      const isDetail = curr.startsWith('/dashboard/') && !isDashboard

      let cls = ''
      if (wasDashboard && isDetail) {
        cls = 'animate-slide-from-right'
      } else if (wasDetail && isDashboard) {
        cls = 'animate-slide-from-left'
      }

      if (cls) {
        containerRef.current.classList.remove('animate-slide-from-right', 'animate-slide-from-left')
        // Force reflow so re-adding the same class restarts the animation
        void containerRef.current.offsetWidth
        containerRef.current.classList.add(cls)
      }

      prevPathRef.current = curr
    }
  }, [location.pathname])

  const handleAnimationEnd = () => {
    containerRef.current?.classList.remove('animate-slide-from-right', 'animate-slide-from-left')
  }

  return (
    <div ref={containerRef} onAnimationEnd={handleAnimationEnd}>
      <Outlet />
    </div>
  )
}
