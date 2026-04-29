import { useQuery } from '@tanstack/react-query'
import { chatApi } from '@/api/chat'
import { qk } from '@/constants/queryKeys'

export function useChatSessions(enabled = true, q?: string) {
  return useQuery({
    queryKey: qk.chat.sessions(q),
    queryFn: () => chatApi.listSessions(q),
    enabled,
    staleTime: 30_000,
  })
}
