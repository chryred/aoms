import { create } from 'zustand'
import { useEffect } from 'react'

interface ChatContextStoreState {
  /** 현재 등록된 페이지별 contextIds (system_id, incident_id) */
  contextIds: {
    system_id?: string
    incident_id?: string
  }
  setContextIds: (ids: { system_id?: string; incident_id?: string }) => void
  clearContextIds: () => void
}

export const useChatContextStore = create<ChatContextStoreState>()((set) => ({
  contextIds: {},
  setContextIds: (ids) => set({ contextIds: ids }),
  clearContextIds: () => set({ contextIds: {} }),
}))

/**
 * 페이지가 마운트될 때 system_id/incident_id를 등록하고,
 * 언마운트 시 자동으로 clear한다.
 */
export function useRegisterScreenContext(ids: { system_id?: string; incident_id?: string }): void {
  const setContextIds = useChatContextStore((s) => s.setContextIds)
  const clearContextIds = useChatContextStore((s) => s.clearContextIds)

  const { system_id, incident_id } = ids

  useEffect(() => {
    setContextIds({ system_id, incident_id })
    return () => {
      clearContextIds()
    }
    // system_id/incident_id primitives으로 dep 지정 (object identity 문제 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system_id, incident_id])
}

