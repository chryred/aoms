import { adminApi } from '@/lib/ky-client'
import type { LlmAgentConfig, LlmAgentConfigCreate, LlmAgentConfigUpdate } from '@/types/llmConfig'

export const llmConfigApi = {
  getConfigs: (isActive?: boolean) => {
    const searchParams: Record<string, string> = {}
    if (isActive !== undefined) searchParams.is_active = String(isActive)
    return adminApi.get('api/v1/llm-agent-configs', { searchParams }).json<LlmAgentConfig[]>()
  },

  getConfig: (areaCode: string) =>
    adminApi.get(`api/v1/llm-agent-configs/${areaCode}`).json<LlmAgentConfig>(),

  createConfig: (body: LlmAgentConfigCreate) =>
    adminApi.post('api/v1/llm-agent-configs', { json: body }).json<LlmAgentConfig>(),

  updateConfig: (id: number, body: LlmAgentConfigUpdate) =>
    adminApi.patch(`api/v1/llm-agent-configs/${id}`, { json: body }).json<LlmAgentConfig>(),

  deleteConfig: (id: number) => adminApi.delete(`api/v1/llm-agent-configs/${id}`),
}
