import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { SynapStateType } from '@/components/mascot'
import { useAuthStore } from '@/store/authStore'

// Module-level timer — keeps NodeJS.Timeout out of Zustand state
let alertTimer: ReturnType<typeof setTimeout> | null = null

/** 대화에서 마지막으로 질문을 보낸 시점의 화면 컨텍스트 (패널을 다른 화면에서 열었는지 판단용) */
export interface LastSentContext {
  sessionId: string
  system_id?: string
  incident_id?: string
}

interface PersistedChatState {
  currentSessionId: string | null
  /**
   * 이 사용자가 직접 고른 조회 범위. null = 고른 적 없음 → 담당(primary) 시스템을 따라간다.
   * 빈 배열 = 전체 시스템. (isOpen 은 새로고침 시 자동으로 열리지 않도록 저장하지 않는다)
   */
  scopeSystemIds: number[] | null
  unread: number
  lastSentContext: LastSentContext | null
}

interface ChatStoreState extends PersistedChatState {
  isOpen: boolean

  // runtime (not persisted)
  thinking: boolean
  inputFocused: boolean
  alertActive: boolean
  /** NextActionCard 등 외부 트리거가 패널 오픈 시 자동 분석을 1회 발화하도록 지정. consume 후 null. */
  autoInsightIncidentId: number | null

  // actions
  toggleOpen: () => void
  setOpen: (open: boolean) => void
  setCurrentSessionId: (id: string | null) => void
  setScopeSystemIds: (ids: number[] | null) => void
  setLastSentContext: (ctx: LastSentContext | null) => void
  setThinking: (thinking: boolean) => void
  setInputFocused: (focused: boolean) => void
  /** 알림 수신 시 alertActive를 8초간 활성화 */
  receiveCritical: () => void
  incrementUnread: () => void
  resetUnread: () => void
  setAutoInsightIncidentId: (id: number | null) => void
}

const PERSISTED_DEFAULTS: PersistedChatState = {
  currentSessionId: null,
  scopeSystemIds: null,
  unread: 0,
  lastSentContext: null,
}

const RUNTIME_DEFAULTS = {
  isOpen: false,
  thinking: false,
  inputFocused: false,
  alertActive: false,
  autoInsightIncidentId: null,
}

export const CHAT_STORAGE_PREFIX = 'chat-ui-state'

/** 로그인 사용자별 저장 키: `chat-ui-state.{userId}`. 로그인 사용자가 없으면 null. */
export function chatStorageKey(userId: number | string | null | undefined): string | null {
  return userId == null ? null : `${CHAT_STORAGE_PREFIX}.${userId}`
}

/** 현재 로그인 사용자의 키로 읽고 쓰는 storage. 로그인 전에는 아무것도 저장하지 않는다. */
const userScopedStorage: StateStorage = {
  getItem: () => {
    const key = chatStorageKey(useAuthStore.getState().user?.id)
    if (!key) return null
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (_name, value) => {
    const key = chatStorageKey(useAuthStore.getState().user?.id)
    if (!key) return
    try {
      localStorage.setItem(key, value)
    } catch {
      // 저장소를 못 쓰는 환경 — 화면은 계속 동작
    }
  },
  removeItem: () => {
    const key = chatStorageKey(useAuthStore.getState().user?.id)
    if (!key) return
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  },
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set) => ({
      ...PERSISTED_DEFAULTS,
      ...RUNTIME_DEFAULTS,

      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),
      setCurrentSessionId: (id) => set({ currentSessionId: id }),
      setScopeSystemIds: (ids) => set({ scopeSystemIds: ids }),
      setLastSentContext: (ctx) => set({ lastSentContext: ctx }),
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
      setAutoInsightIncidentId: (id) => set({ autoInsightIncidentId: id }),
    }),
    {
      name: CHAT_STORAGE_PREFIX,
      storage: createJSONStorage(() => userScopedStorage),
      partialize: (state): PersistedChatState => ({
        currentSessionId: state.currentSessionId,
        scopeSystemIds: state.scopeSystemIds,
        unread: state.unread,
        lastSentContext: state.lastSentContext,
      }),
      // 저장된 값이 없는 사용자(null)도 이전 사용자의 메모리 상태를 물려받지 않도록 기본값으로 덮는다
      merge: (persisted, current) => ({
        ...current,
        ...PERSISTED_DEFAULTS,
        ...RUNTIME_DEFAULTS,
        ...(persisted as Partial<PersistedChatState> | undefined),
      }),
    },
  ),
)

// 로그인 사용자가 바뀌면(로그인·로그아웃·계정 전환) 패널을 닫고 그 사용자 키로 다시 읽는다.
// 로그아웃(user=null)이면 storage 가 비활성이라 기본값으로만 초기화된다.
useAuthStore.subscribe((state, prev) => {
  if (state.user?.id === prev.user?.id) return
  void useChatStore.persist.rehydrate()
})

/** Synap 마스코트 상태 파생 선택자 (우선순위: thinking > listening > alert > idle) */
export function useSynapState(): SynapStateType {
  return useChatStore((s) => {
    if (s.thinking) return 'thinking'
    if (s.inputFocused) return 'listening'
    if (s.alertActive) return 'alert'
    return 'idle'
  })
}
