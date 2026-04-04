import { create } from 'zustand'

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
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  sidebarOpen: false,
  toggleMobileSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  closeMobileSidebar: () => set({ sidebarOpen: false }),
  criticalCount: 0,
  setCriticalCount: (n) => set({ criticalCount: n }),
}))
