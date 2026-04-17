export interface LlmAgentConfig {
  id: number
  area_code: string
  area_name: string
  agent_code: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface LlmAgentConfigCreate {
  area_code: string
  area_name: string
  agent_code: string
  description?: string
  is_active?: boolean
}

export interface LlmAgentConfigUpdate {
  area_name?: string
  agent_code?: string
  description?: string
  is_active?: boolean
}
