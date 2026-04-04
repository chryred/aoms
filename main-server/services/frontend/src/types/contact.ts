export type ContactRole = 'primary' | 'secondary' | 'escalation'
export type NotifyChannel = 'teams' | 'webhook'

export interface Contact {
  id: number
  name: string
  email: string | null
  teams_upn: string | null
  webhook_url: string | null
  llm_api_key: string | null
  agent_code: string | null
  created_at: string
  updated_at: string
}

export interface ContactCreate {
  name: string
  email?: string
  teams_upn?: string
  webhook_url?: string
  llm_api_key?: string
  agent_code?: string
}

export interface SystemContact {
  id: number
  system_id: number
  contact_id: number
  role: ContactRole
  notify_channels: NotifyChannel[]
  contact: Contact
}

export interface SystemContactCreate {
  contact_id: number
  role: ContactRole
  notify_channels: NotifyChannel[]
}
