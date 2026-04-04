import { create } from 'zustand'

interface UiState {
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  criticalCount: number
  setCriticalCount: (n: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  criticalCount: 0,
  setCriticalCount: (n) => set({ criticalCount: n }),
}))
