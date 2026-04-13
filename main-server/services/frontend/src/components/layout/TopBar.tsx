import { LogOut, Menu } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { authApi } from '@/api/auth'
import { CommandSearch } from './CommandSearch'
import { ThemeToggle } from './ThemeToggle'

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
    <header className="border-border-brand bg-surface flex shrink-0 items-center justify-between border-b px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={toggleMobileSidebar}
          aria-label="메뉴 열기"
          className="text-text-secondary hover:bg-hover-subtle focus:ring-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-sm focus:ring-1 focus:outline-none md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <CommandSearch />
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        {user && (
          <span className="text-text-secondary hidden text-sm sm:block">
            {user.name} <span className="text-text-disabled text-xs">({user.role})</span>
          </span>
        )}
        <ThemeToggle />
        <button
          onClick={handleLogout}
          aria-label="로그아웃"
          className="text-text-secondary hover:bg-hover-subtle focus:ring-accent flex min-h-[40px] items-center gap-1.5 rounded-sm px-2.5 py-2 text-sm focus:ring-1 focus:outline-none md:px-3"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">로그아웃</span>
        </button>
      </div>
    </header>
  )
}
