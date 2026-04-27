import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ChatStoreState {
  isOpen: boolean
  currentSessionId: string | null
  /** 검색 필터용 시스템 ID (null = 전체 시스템) */
  filterSystemId: number | null
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setCurrentSessionId: (id: string | null) => void
  setFilterSystemId: (id: number | null) => void
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set) => ({
      isOpen: false,
      currentSessionId: null,
      filterSystemId: null,
      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
      setCurrentSessionId: (id) => set({ currentSessionId: id }),
      setFilterSystemId: (id) => set({ filterSystemId: id }),
    }),
    {
      name: 'chat-ui-state',
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        isOpen: state.isOpen,
        filterSystemId: state.filterSystemId,
      }),
    },
  ),
)
