export type SystemStatus = 'active' | 'inactive'

export interface System {
  id: number
  system_name: string
  display_name: string
  description: string | null
  status: SystemStatus
  teams_webhook_url: string | null
  created_at: string
  updated_at: string
}

export interface SystemBrief {
  id: number
  system_name: string
  display_name: string
}

export interface SystemCreate {
  system_name: string
  display_name: string
  description?: string
  status?: SystemStatus
  teams_webhook_url?: string
}

export type SystemUpdate = Partial<Omit<SystemCreate, 'system_name'>>
