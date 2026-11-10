import { useCallback, useMemo } from 'react'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import { useChatStore } from '@/store/chatStore'
import { sameIdSet } from '@/lib/chatScope'

/**
 * 챗봇 기본 조회 범위.
 * 사용자가 직접 고른 값(스토어 scopeSystemIds)이 있으면 그것, 없으면 로그인 사용자의 담당(primary) 시스템.
 * 담당이 없으면 빈 배열 = 전체 시스템 (admin 도 동일 — 예전의 "admin = 전 시스템 선택" 규칙은 폐기).
 */
export function useChatScope() {
  const override = useChatStore((s) => s.scopeSystemIds)
  const setScopeSystemIds = useChatStore((s) => s.setScopeSystemIds)
  const { data: primary, isPending } = useMyPrimarySystems()

  const primaryIds = useMemo(() => (primary ?? []).map((p) => p.system_id), [primary])
  const scopeIds = useMemo(() => override ?? primaryIds, [override, primaryIds])
  /** 담당 시스템 응답을 받기 전에 세션을 만들면 범위가 잘못 저장되므로 기다린다 */
  const ready = override !== null || !isPending

  /** 이 사용자의 기본값으로 저장. 담당 시스템과 같아지면 "직접 고른 값 없음"으로 되돌린다 */
  const saveScope = useCallback(
    (ids: number[]) => setScopeSystemIds(sameIdSet(ids, primaryIds) ? null : ids),
    [primaryIds, setScopeSystemIds],
  )

  return { scopeIds, primaryIds, ready, saveScope }
}
