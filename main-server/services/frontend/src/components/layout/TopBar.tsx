import { useLocation } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
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

  const baseKey = '/' + pathname.split('/')[1]
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[baseKey] ?? 'AOMS'

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } finally {
      logout()
      window.location.href = '/login'
    }
  }

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-[#E8EBF0] border-b border-[#D4D7DE] shrink-0">
      <h2 className="text-lg font-semibold text-[#1A1F2E]">{title}</h2>
      <div className="flex items-center gap-3">
        {user && (
          <span className="text-sm text-[#4A5568]">
            {user.name}{' '}
            <span className="text-xs text-[#A0A4B0]">({user.role})</span>
          </span>
        )}
        <button
          onClick={handleLogout}
          aria-label="로그아웃"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[#4A5568]
                     hover:bg-[rgba(0,0,0,0.05)] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </div>
    </header>
  )
}
