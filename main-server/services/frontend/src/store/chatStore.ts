import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SynapStateType } from '@/components/mascot'

// Module-level timer — keeps NodeJS.Timeout out of Zustand state
let alertTimer: ReturnType<typeof setTimeout> | null = null

interface ChatStoreState {
  // persisted
  isOpen: boolean
  currentSessionId: string | null
  /** 검색 필터용 시스템 ID (null = 전체 시스템) */
  filterSystemId: number | null
  unread: number

  // runtime (not persisted)
  thinking: boolean
  inputFocused: boolean
  alertActive: boolean

  // actions
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setCurrentSessionId: (id: string | null) => void
  setFilterSystemId: (id: number | null) => void
  setThinking: (thinking: boolean) => void
  setInputFocused: (focused: boolean) => void
  /** 알림 수신 시 alertActive를 8초간 활성화 */
  receiveCritical: () => void
  incrementUnread: () => void
  resetUnread: () => void
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set) => ({
      isOpen: false,
      currentSessionId: null,
      filterSystemId: null,
      unread: 0,
      thinking: false,
      inputFocused: false,
      alertActive: false,

      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
      setCurrentSessionId: (id) => set({ currentSessionId: id }),
      setFilterSystemId: (id) => set({ filterSystemId: id }),
      setThinking: (thinking) => set({ thinking }),
      setInputFocused: (focused) => set({ inputFocused: focused }),
      receiveCritical: () => {
        if (alertTimer) clearTimeout(alertTimer)
        set({ alertActive: true })
        alertTimer = setTimeout(() => {
          set({ alertActive: false })
          alertTimer = null
        }, 8000)
      },
      incrementUnread: () => set((s) => ({ unread: s.unread + 1 })),
      resetUnread: () => set({ unread: 0 }),
    }),
    {
      name: 'chat-ui-state',
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        isOpen: state.isOpen,
        filterSystemId: state.filterSystemId,
        unread: state.unread,
      }),
    },
  ),
)

/** Synap 마스코트 상태 파생 선택자 (우선순위: thinking > listening > alert > idle) */
export function useSynapState(): SynapStateType {
  return useChatStore((s) => {
    if (s.thinking) return 'thinking'
    if (s.inputFocused) return 'listening'
    if (s.alertActive) return 'alert'
    return 'idle'
  })
}
