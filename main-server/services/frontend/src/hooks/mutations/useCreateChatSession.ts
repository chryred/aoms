import { useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '@/api/chat'
import { qk } from '@/constants/queryKeys'
import type { ChatSession } from '@/types/chat'

export function useCreateChatSession() {
  const qc = useQueryClient()
  return useMutation({
    /** systemIds 를 주면 생성과 동시에 세션 기본 범위로 저장된다(생성 후 PATCH 불필요) */
    mutationFn: (systemIds?: number[]) => chatApi.createSession(systemIds),
    onSuccess: (created) => {
      // 비활성(패널 닫힘) 상태의 캐시는 invalidate 만으로 즉시 갱신되지 않아, 곧바로 다시 열면 낡은 목록으로
      // "오늘 세션 없음"을 판단해 세션이 중복 생성된다 → 생성된 세션을 캐시에 먼저 넣는다
      qc.setQueryData<ChatSession[]>(qk.chat.sessions(), (old) =>
        old && !old.some((s) => s.id === created.id) ? [created, ...old] : old,
      )
      qc.invalidateQueries({ queryKey: qk.chat.sessions() })
    },
  })
}

export function useDeleteChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => chatApi.deleteSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.chat.sessions() })
    },
  })
}

export function useRestoreChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => chatApi.restoreSession(sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.chat.sessions() })
    },
  })
}
