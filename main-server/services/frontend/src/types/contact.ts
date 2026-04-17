export type ContactRole = 'primary' | 'secondary' | 'escalation'
export type NotifyChannel = 'teams' | 'webhook'

export interface ContactSystem {
  id: number
  system_name: string
  display_name: string
}

export interface Contact {
  id: number
  name: string
  email: string | null
  teams_upn: string | null
  webhook_url: string | null
  created_at: string
  updated_at: string
  systems: ContactSystem[]
}

export interface ContactCreate {
  name: string
  email?: string
  teams_upn?: string
  webhook_url?: string
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
