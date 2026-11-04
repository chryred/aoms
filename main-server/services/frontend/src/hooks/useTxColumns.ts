import { useCallback, useState } from 'react'

/** 열 선택으로 숨길 수 있는 보조 열 */
export const TOGGLEABLE_COLS = [
  { key: 'fetch', label: 'fetch' },
  { key: 'ext', label: '외부(ms)' },
  { key: 'user', label: '사용자' },
  { key: 'host', label: '호스트' },
] as const

/** 기본으로 숨기는 보조 열 (트랜잭션 목록) */
export const DEFAULT_HIDDEN_TX_COLS = ['ext', 'host', 'user', 'fetch'] as const

const storageKey = (userId: number | string | undefined) =>
  `synapse.apmTx.hiddenCols.${userId ?? 'anon'}`

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return new Set(DEFAULT_HIDDEN_TX_COLS)
    const parsed: unknown = JSON.parse(raw)
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [],
    )
  } catch {
    return new Set(DEFAULT_HIDDEN_TX_COLS)
  }
}

/** 트랜잭션 목록에서 숨긴 열 키 집합. 사용자별 localStorage 에 유지(저장 불가여도 화면은 동작). */
export function useTxColumns(userId: number | string | undefined) {
  const key = storageKey(userId)
  const [hidden, setHidden] = useState<Set<string>>(() => load(key))

  const setVisible = useCallback(
    (col: string, visible: boolean) =>
      setHidden((prev) => {
        const next = new Set(prev)
        if (visible) next.delete(col)
        else next.add(col)
        try {
          localStorage.setItem(key, JSON.stringify([...next]))
        } catch {
          // 저장소를 못 쓰는 환경
        }
        return next
      }),
    [key],
  )

  return { hidden, setVisible }
}
