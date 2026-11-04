import { createContext } from 'react'

/** 위젯 간 공유 상태: 큐 막대 클릭 → 진행 중 목록 필터, 시스템 이름 조회. */
export interface LiveContextValue {
  queueFilter: string | null
  setQueueFilter: (key: string | null) => void
  systemName: (id: number) => string
  /** 인스턴스 키 → 시리즈 색 CSS 변수 이름 (예: --t-series-3) */
  colorOf: (key: string) => string
  /** 시스템 id + role → 표시 이름. 범위에 시스템이 둘 이상이면 "시스템·role", 하나면 role 만 */
  instanceLabel: (systemId: number, role: string) => string
  /** 인스턴스 키 → 범례 라벨 */
  labelOf: (key: string) => string
}

export const LiveContext = createContext<LiveContextValue>({
  queueFilter: null,
  setQueueFilter: () => {},
  systemName: (id) => `#${id}`,
  colorOf: () => '--color-accent',
  instanceLabel: (_id, role) => role,
  labelOf: (key) => key,
})
