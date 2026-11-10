import { useCallback, useEffect, useRef, useState } from 'react'
import { useChatSessions } from '@/hooks/queries/useChatSessions'
import { useCreateChatSession } from '@/hooks/mutations/useCreateChatSession'
import { useChatStore } from '@/store/chatStore'
import { isSameKstDay } from '@/lib/utils'
import type { ChatSession } from '@/types/chat'

interface Options {
  /** 패널이 열려 있거나 /chat 페이지에 있을 때 true. false→true 전환마다 "오늘 대화" 판정을 다시 한다 */
  active: boolean
  /** 새 세션에 심을 기본 범위(system_ids). 빈 배열 = 전체 */
  scopeIds: number[]
  /** 담당 시스템 응답을 받아 scopeIds 가 확정됐는지 */
  scopeReady: boolean
}

/**
 * 챗봇 세션 자동 선택·생성의 단일 지점 (우하단 패널과 /chat 공용).
 *
 * 활성화될 때마다 1회:
 *  - 현재 세션이 오늘(KST) 시작한 것이면 유지
 *  - 아니면 오늘 시작한 가장 최근 세션(빈 세션 포함)을 재사용
 *  - 그것도 없으면 `POST /chat/sessions {system_ids}` 한 번으로 새 세션 생성
 * 활성 중 현재 세션이 사라지면(삭제·404) 같은 규칙으로 다시 고른다.
 * 동시 생성은 ref 플래그로 막는다(StrictMode 이중 effect·연타 포함).
 */
export function useChatSessionBootstrap({ active, scopeIds, scopeReady }: Options) {
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const setCurrentSessionId = useChatStore((s) => s.setCurrentSessionId)
  const { data: sessions } = useChatSessions(active)
  const { mutateAsync: createSessionAsync, isPending: isCreating } = useCreateChatSession()

  /** 이번 활성화에서 사용할 세션이 정해졌는지 — 정해지기 전에는 전송·자동 분석을 막는다 */
  const [ready, setReady] = useState(false)
  const handledRef = useRef(false)
  const creatingRef = useRef(false)
  const scopeRef = useRef(scopeIds)
  scopeRef.current = scopeIds

  const startNewSession = useCallback(async (): Promise<ChatSession | null> => {
    if (creatingRef.current) return null
    creatingRef.current = true
    try {
      const created = await createSessionAsync(scopeRef.current)
      setCurrentSessionId(created.id)
      return created
    } catch {
      return null
    } finally {
      creatingRef.current = false
    }
  }, [createSessionAsync, setCurrentSessionId])

  useEffect(() => {
    if (!active) {
      handledRef.current = false
      setReady(false)
    }
  }, [active])

  useEffect(() => {
    if (!active || sessions === undefined || !scopeReady) return
    if (creatingRef.current) return
    if (handledRef.current && currentSessionId) return

    handledRef.current = true
    const current = currentSessionId ? sessions.find((s) => s.id === currentSessionId) : undefined
    if (current && isSameKstDay(current.created_at)) {
      setReady(true)
      return
    }
    const newestToday = sessions
      .filter((s) => isSameKstDay(s.created_at))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    if (newestToday) {
      setCurrentSessionId(newestToday.id)
      setReady(true)
      return
    }
    void startNewSession().then((s) => {
      if (s) setReady(true)
    })
  }, [active, sessions, scopeReady, currentSessionId, setCurrentSessionId, startNewSession])

  return { ready, isCreating, startNewSession, sessions }
}
