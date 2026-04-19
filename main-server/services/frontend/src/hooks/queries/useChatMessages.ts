import { useQuery } from '@tanstack/react-query'
import { chatApi } from '@/api/chat'
import { qk } from '@/constants/queryKeys'

export function useChatMessages(sessionId: string | null) {
  return useQuery({
    queryKey: qk.chat.messages(sessionId ?? ''),
    queryFn: () => chatApi.getMessages(sessionId as string),
    enabled: !!sessionId,
    staleTime: 0,
  })
}
