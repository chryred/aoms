import { useQuery } from '@tanstack/react-query'
import { chatExecutorConfigsApi, chatToolsApi } from '@/api/chatTools'
import { qk } from '@/constants/queryKeys'

export function useChatTools() {
  return useQuery({
    queryKey: qk.chat.tools(),
    queryFn: () => chatToolsApi.list(),
    staleTime: 30_000,
  })
}

export function useChatExecutorConfigs() {
  return useQuery({
    queryKey: qk.chat.executorConfigs(),
    queryFn: () => chatExecutorConfigsApi.list(),
    staleTime: 30_000,
  })
}
