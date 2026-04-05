import { LogOut, Menu } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { authApi } from '@/api/auth'
import { CommandSearch } from './CommandSearch'

export function TopBar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const toggleMobileSidebar = useUiStore((s) => s.toggleMobileSidebar)

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } finally {
      logout()
      window.location.href = '/login'
    }
  }

  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-3 bg-[#252932] border-b border-[#9E7B2F80] shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggleMobileSidebar}
          aria-label="메뉴 열기"
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-sm text-[#8B97AD]
                     hover:bg-[rgba(255,255,255,0.05)] focus:outline-none focus:ring-1 focus:ring-[#00D4FF]
                     shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <CommandSearch />
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
          className="flex items-center gap-1.5 rounded-sm px-2.5 py-2 md:px-3 text-sm text-[#8B97AD]
                     hover:bg-[rgba(255,255,255,0.05)] focus:outline-none focus:ring-1 focus:ring-[#00D4FF]
                     min-h-[40px]"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">로그아웃</span>
        </button>
      </div>
    </header>
  )
}
