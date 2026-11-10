import type { ChatMessage, ChatScopeEvent } from '@/types/chat'
import type { System } from '@/types/system'

/** SSE `scope` 이벤트 → 스트리밍 답변 위에 보이는 한 줄 라벨 */
export function describeScope(scope: ChatScopeEvent | null | undefined): string | null {
  if (!scope) return null
  if (scope.source === 'all' || scope.systems.length === 0) return '전체 시스템 기준'
  const names = scope.systems.map((s) => s.display_name || s.system_name).join('·')
  return scope.source === 'screen' ? `현재 화면(${names}) 기준` : `${names} 기준으로 조회`
}

/**
 * 같은 턴(직전 user 메시지 이후)의 tool 메시지 system_id 를 모아 assistant 메시지 id → 시스템 이름 배열로 반환.
 * 조회한 시스템이 없으면 해당 assistant 는 맵에 넣지 않는다.
 */
export function buildQueriedSystemNames(
  messages: ChatMessage[] | undefined,
  systems: Pick<System, 'id' | 'display_name' | 'system_name'>[],
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  if (!messages || messages.length === 0) return result
  const nameOf = new Map(systems.map((s) => [s.id, s.display_name || s.system_name]))
  let turnIds: number[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      turnIds = []
    } else if (m.role === 'tool') {
      if (m.system_id != null && !turnIds.includes(m.system_id)) turnIds.push(m.system_id)
    } else if (m.role === 'assistant' && turnIds.length > 0) {
      const names = turnIds.map((id) => nameOf.get(id)).filter((n): n is string => !!n)
      if (names.length > 0) result.set(m.id, names)
    }
  }
  return result
}

/** 범위 칩 텍스트 — 담당 시스템 / 선택 시스템 / 전체 시스템 */
export function describeScopeChip(
  ids: number[],
  primaryIds: number[],
  systems: Pick<System, 'id' | 'display_name'>[],
): string {
  if (ids.length === 0) return '전체 시스템'
  const names = ids
    .map((id) => systems.find((s) => s.id === id)?.display_name)
    .filter((n): n is string => !!n)
  const shown =
    names.length > 3 ? `${names.slice(0, 3).join('·')} 외 ${names.length - 3}` : names.join('·')
  return `${sameIdSet(ids, primaryIds) ? '담당 시스템' : '선택 시스템'}: ${shown || `${ids.length}개`}`
}

export function sameIdSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}
