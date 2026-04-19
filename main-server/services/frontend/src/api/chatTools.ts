import { adminApi } from '@/lib/ky-client'
import type { ChatExecutorConfig, ChatExecutorTestResult, ChatTool } from '@/types/chat'

export const chatToolsApi = {
  list: () => adminApi.get('api/v1/chat-tools').json<ChatTool[]>(),
  toggle: (name: string, is_enabled: boolean) =>
    adminApi.patch(`api/v1/chat-tools/${name}`, { json: { is_enabled } }).json<ChatTool>(),
}

export const chatExecutorConfigsApi = {
  list: () => adminApi.get('api/v1/chat-executor-configs').json<ChatExecutorConfig[]>(),
  save: (executor: string, config: Record<string, unknown>) =>
    adminApi
      .put(`api/v1/chat-executor-configs/${executor}`, { json: { config } })
      .json<ChatExecutorConfig>(),
  test: (executor: string, config?: Record<string, string>) =>
    adminApi
      .post(`api/v1/chat-executor-configs/${executor}/test`, {
        json: { config: config ?? null },
        timeout: 15_000,
      })
      .json<ChatExecutorTestResult>(),
}
