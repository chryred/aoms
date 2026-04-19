export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ChatAttachment {
  type: 'image'
  key: string
  mime: string
  size: number
  width?: number
  height?: number
}

export interface ChatMessage {
  id: string
  session_id: string
  role: ChatRole
  content: string
  thought?: string | null
  tool_name?: string | null
  tool_args?: Record<string, unknown> | null
  tool_result?: Record<string, unknown> | null
  attachments: ChatAttachment[]
  created_at: string
}

export interface ChatSession {
  id: string
  title: string
  area_code: string
  created_at: string
  updated_at: string
}

export interface ChatTool {
  name: string
  display_name: string
  description: string
  executor: 'ems' | 'admin' | 'log_analyzer'
  input_schema: Record<string, unknown>
  is_enabled: boolean
}

export interface ChatExecutorFieldSchema {
  key: string
  label: string
  type: 'string' | 'password' | 'url'
  required?: boolean
  secret?: boolean
  help?: string
}

export interface ChatExecutorConfig {
  executor: string
  config: Record<string, string | number | boolean | null>
  config_schema: ChatExecutorFieldSchema[]
  updated_at?: string | null
}

export interface ChatExecutorTestResult {
  ok: boolean
  message?: string | null
}

export type ChatStreamEventType =
  | 'user_saved'
  | 'iter_start'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'token'
  | 'final'
  | 'error'

export interface ChatStreamEvent {
  type: ChatStreamEventType
  data: Record<string, unknown>
}
