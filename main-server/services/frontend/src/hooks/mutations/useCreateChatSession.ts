import { useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '@/api/chat'
import { qk } from '@/constants/queryKeys'

export function useCreateChatSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => chatApi.createSession(),
    onSuccess: () => {
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
