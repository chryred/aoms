import { createContext, useContext, useEffect } from 'react'
import { useTabStore } from '@/store/tabStore'

/** 이 컴포넌트가 속한 탭의 key(pathname). 탭 밖이면 null */
export const TabKeyContext = createContext<string | null>(null)
/** 이 탭이 현재 보이는(활성) 탭인지. 탭 밖이면 true */
export const TabActiveContext = createContext<boolean>(true)

/**
 * 현재 페이지가 활성 탭인지 반환한다. 비활성 탭은 DOM 에 마운트된 채 숨겨져 있으므로
 * 폴링·SSE·애니메이션 같은 무거운 작업은 이 값이 false 일 때 멈춘다.
 *
 *   refetchInterval: active ? 30_000 : false
 *   useEffect(() => { if (!active) return; const es = open(); return () => es.close() }, [active])
 */
export function useTabActive(): boolean {
  return useContext(TabActiveContext)
}

/** 탭 제목을 페이지 데이터 기반(호스트명, URI 등)으로 갱신한다. title 이 falsy 면 기본 제목 유지 */
export function useTabTitle(title: string | null | undefined): void {
  const key = useContext(TabKeyContext)
  const setTitle = useTabStore((s) => s.setTitle)
  useEffect(() => {
    if (key && title) setTitle(key, title)
  }, [key, title, setTitle])
}
