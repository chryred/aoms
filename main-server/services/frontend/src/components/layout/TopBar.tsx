import { useLocation } from 'react-router-dom'
import { LogOut, Menu } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { authApi } from '@/api/auth'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': '운영 대시보드',
  '/alerts': '알림 이력',
  '/systems': '시스템 관리',
  '/contacts': '담당자 관리',
  '/reports': '안정성 리포트',
  '/search': '유사 장애 검색',
  '/trends': '트렌드 예측',
  '/feedback': '피드백 관리',
  '/collector-configs': '수집기 설정',
  '/vector-health': '벡터 컬렉션 상태',
  '/profile': '내 프로필',
  '/admin/users': '사용자 관리',
}

export function TopBar() {
  const { pathname } = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const toggleMobileSidebar = useUiStore((s) => s.toggleMobileSidebar)

  const baseKey = '/' + pathname.split('/')[1]
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[baseKey] ?? 'Synapse-V'

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } finally {
      logout()
      window.location.href = '/login'
    }
  }

  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-3 bg-[#1E2127] border-b border-[#2B2F37] shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggleMobileSidebar}
          aria-label="메뉴 열기"
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg text-[#8B97AD]
                     hover:bg-[rgba(255,255,255,0.05)] focus:outline-none focus:ring-2 focus:ring-[#00D4FF]
                     shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-base md:text-lg font-semibold text-[#E2E8F2] truncate">{title}</h2>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {user && (
          <span className="hidden sm:block text-sm text-[#8B97AD]">
            {user.name}{' '}
            <span className="text-xs text-[#5A6478]">({user.role})</span>
          </span>
        )}
        <button
          onClick={handleLogout}
          aria-label="로그아웃"
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 md:px-3 text-sm text-[#8B97AD]
                     hover:bg-[rgba(255,255,255,0.05)] focus:outline-none focus:ring-2 focus:ring-[#00D4FF]
                     min-h-[40px]"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">로그아웃</span>
        </button>
      </div>
    </header>
  )
}
