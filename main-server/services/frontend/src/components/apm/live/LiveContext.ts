import { createContext } from 'react'

/** 위젯 간 공유 상태: 큐 막대 클릭 → 진행 중 목록 필터, 시스템 이름 조회. */
export interface LiveContextValue {
  queueFilter: string | null
  setQueueFilter: (key: string | null) => void
  systemName: (id: number) => string
}

export const LiveContext = createContext<LiveContextValue>({
  queueFilter: null,
  setQueueFilter: () => {},
  systemName: (id) => `#${id}`,
})
