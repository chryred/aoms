import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ChatStoreState {
  isOpen: boolean
  currentSessionId: string | null
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setCurrentSessionId: (id: string | null) => void
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set) => ({
      isOpen: false,
      currentSessionId: null,
      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
      setCurrentSessionId: (id) => set({ currentSessionId: id }),
    }),
    {
      name: 'chat-ui-state',
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        isOpen: state.isOpen,
      }),
    },
  ),
)
