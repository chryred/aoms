import { useCallback, useState } from 'react'

const storageKey = (userId: number | string | undefined) =>
  `synapse.apmLive.excludedInstances.${userId ?? 'anon'}`

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

/**
 * 실시간 모니터링에서 제외(체크 해제)한 인스턴스 키 집합. 사용자별 localStorage 에 유지한다.
 * 제외 목록만 저장하므로 새로 나타난 인스턴스는 기본으로 포함(체크)된다.
 */
export function useExcludedInstances(userId: number | string | undefined) {
  const key = storageKey(userId)
  const [excluded, setExcluded] = useState<Set<string>>(() => load(key))

  /** keys 를 한꺼번에 포함(checked=true) 또는 제외(false) 한다. */
  const setChecked = useCallback(
    (keys: string[], checked: boolean) =>
      setExcluded((prev) => {
        const next = new Set(prev)
        for (const k of keys) {
          if (checked) next.delete(k)
          else next.add(k)
        }
        try {
          localStorage.setItem(key, JSON.stringify([...next]))
        } catch {
          // 저장소를 못 쓰는 환경에서도 화면 상태는 그대로 동작한다
        }
        return next
      }),
    [key],
  )

  return { excluded, setChecked }
}
