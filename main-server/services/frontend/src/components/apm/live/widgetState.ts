import { createContext, useCallback, useContext, useState } from 'react'

/**
 * 위젯별 공유 상태. 카드와 확대 오버레이는 같은 위젯 id 를 쓰므로 범위 선택 등
 * 로컬 상태가 두 인스턴스 사이에서 동기화된다. 실시간 점 버퍼는 이미 페이지의 events 를 공유한다.
 */
export interface WidgetRuntime {
  /** 이 위젯의 id (레이아웃 항목 i) */
  widgetId: string
  /** 위젯 id → 키 → 값 */
  state: Record<string, Record<string, unknown>>
  setState: (widgetId: string, key: string, value: unknown) => void
  /** 확대 오버레이를 닫는다 (확대 중이 아니면 no-op). 다른 탭으로 이동하기 전에 호출 */
  closeZoom: () => void
}

export const WidgetRuntimeContext = createContext<WidgetRuntime>({
  widgetId: '',
  state: {},
  setState: () => {},
  closeZoom: () => {},
})

/** 위젯 id 별 공유 상태. Provider 밖(widgetId 없음)이면 일반 로컬 state 로 동작한다. */
export function useWidgetState<T>(key: string, initial: T): [T, (v: T) => void] {
  const { widgetId, state, setState } = useContext(WidgetRuntimeContext)
  const [local, setLocal] = useState<T>(initial)
  const shared = (state[widgetId]?.[key] as T | undefined) ?? initial
  const setShared = useCallback((v: T) => setState(widgetId, key, v), [setState, widgetId, key])
  return widgetId ? [shared, setShared] : [local, setLocal]
}
