import { create } from 'zustand'
import { useEffect } from 'react'
import { useTabActive } from '@/components/layout/tabs/TabContext'

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
 * 멀티 탭(keep-alive)에서 숨겨진 탭은 등록하지 않는다 — 탭이 다시 활성화되면 그때 등록해 보이는 화면의 값만 남게 한다.
 */
export function useRegisterScreenContext(ids: { system_id?: string; incident_id?: string }): void {
  const setContextIds = useChatContextStore((s) => s.setContextIds)
  const clearContextIds = useChatContextStore((s) => s.clearContextIds)
  const tabActive = useTabActive()

  const { system_id, incident_id } = ids

  useEffect(() => {
    if (!tabActive) return
    setContextIds({ system_id, incident_id })
    return () => {
      clearContextIds()
    }
    // system_id/incident_id primitives으로 dep 지정 (object identity 문제 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabActive, system_id, incident_id])
}
