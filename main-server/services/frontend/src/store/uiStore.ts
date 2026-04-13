import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface UiState {
  // Desktop: collapsed/expanded toggle
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  // Mobile: overlay open/close
  sidebarOpen: boolean
  toggleMobileSidebar: () => void
  closeMobileSidebar: () => void
  // Critical alert count
  criticalCount: number
  setCriticalCount: (n: number) => void
  // Theme
  theme: Theme
  toggleTheme: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  sidebarOpen: false,
  toggleMobileSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeMobileSidebar: () => set({ sidebarOpen: false }),
  criticalCount: 0,
  setCriticalCount: (n) => set({ criticalCount: n }),
  theme: (localStorage.getItem('theme') as Theme) ?? 'dark',
  toggleTheme: () =>
    set((s) => {
      const next: Theme = s.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      if (next === 'light') {
        document.documentElement.classList.add('light')
      } else {
        document.documentElement.classList.remove('light')
      }
      return { theme: next }
    }),
}))
