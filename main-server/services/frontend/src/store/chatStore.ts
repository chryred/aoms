import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SynapStateType } from '@/components/mascot'
import type { ScreenContext } from '@/types/chat'

// Module-level timer — keeps NodeJS.Timeout out of Zustand state
let alertTimer: ReturnType<typeof setTimeout> | null = null

interface ChatStoreState {
  // persisted
  isOpen: boolean
  currentSessionId: string | null
  /** 검색 필터용 시스템 ID 배열 (빈 배열 = 선택 없음 / W3 통합 시 디폴트 결정) */
  filterSystemIds: number[]
  unread: number

  // runtime (not persisted)
  thinking: boolean
  inputFocused: boolean
  alertActive: boolean
  /** ChatLauncher가 열릴 때 현재 화면 컨텍스트를 1회용으로 저장. localStorage에서 제외. */
  pendingScreenContext: ScreenContext | null
  /** NextActionCard 등 외부 트리거가 패널 오픈 시 자동 분석을 1회 발화하도록 지정. consume 후 null. */
  autoInsightIncidentId: number | null

  // actions
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setCurrentSessionId: (id: string | null) => void
  setFilterSystemIds: (ids: number[]) => void
  setThinking: (thinking: boolean) => void
  setInputFocused: (focused: boolean) => void
  /** 알림 수신 시 alertActive를 8초간 활성화 */
  receiveCritical: () => void
  incrementUnread: () => void
  resetUnread: () => void
  setPendingScreenContext: (ctx: ScreenContext) => void
  /** 읽고 null로 초기화 (1회 소비) */
  consumePendingScreenContext: () => ScreenContext | null
  setAutoInsightIncidentId: (id: number | null) => void
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set) => ({
      isOpen: false,
      currentSessionId: null,
      // Note: previously persisted as `filterSystemId` — existing localStorage entries are
      // silently dropped by Zustand (unknown key). No version bump needed.
      filterSystemIds: [],
      unread: 0,
      thinking: false,
      inputFocused: false,
      alertActive: false,
      pendingScreenContext: null,
      autoInsightIncidentId: null,

      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
      setCurrentSessionId: (id) => set({ currentSessionId: id }),
      setFilterSystemIds: (ids) => set({ filterSystemIds: ids }),
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
      setPendingScreenContext: (ctx) => set({ pendingScreenContext: ctx }),
      consumePendingScreenContext: () => {
        let ctx: ScreenContext | null = null
        set((s) => {
          ctx = s.pendingScreenContext
          return { pendingScreenContext: null }
        })
        return ctx
      },
      setAutoInsightIncidentId: (id) => set({ autoInsightIncidentId: id }),
    }),
    {
      name: 'chat-ui-state',
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        isOpen: state.isOpen,
        filterSystemIds: state.filterSystemIds,
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
