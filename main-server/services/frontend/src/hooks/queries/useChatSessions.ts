import { useQuery } from '@tanstack/react-query'
import { chatApi } from '@/api/chat'
import { qk } from '@/constants/queryKeys'

export function useChatSessions(enabled = true) {
  return useQuery({
    queryKey: qk.chat.sessions(),
    queryFn: () => chatApi.listSessions(),
    enabled,
    staleTime: 30_000,
  })
}
