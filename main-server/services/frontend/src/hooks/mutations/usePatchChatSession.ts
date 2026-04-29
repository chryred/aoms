import { useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '@/api/chat'
import { qk } from '@/constants/queryKeys'

interface PatchChatSessionInput {
  sessionId: string
  data: { title?: string; system_ids?: number[] }
}

export function usePatchChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sessionId, data }: PatchChatSessionInput) =>
      chatApi.patchSession(sessionId, data),
    onSuccess: (_, { sessionId }) => {
      // Invalidate all sessions lists (with or without q filter)
      qc.invalidateQueries({ queryKey: ['chat', 'sessions'] })
      // Invalidate single session messages cache
      qc.invalidateQueries({ queryKey: qk.chat.messages(sessionId) })
    },
  })
}
