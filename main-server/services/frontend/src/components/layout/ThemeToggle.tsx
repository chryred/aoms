import { Sun, Moon } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      className="text-text-secondary hover:bg-hover-subtle focus:ring-accent flex h-9 w-9 items-center justify-center rounded-sm transition-colors focus:ring-1 focus:outline-none"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  )
}
