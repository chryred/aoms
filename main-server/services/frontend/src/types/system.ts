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

export interface SystemHost {
  id: number
  system_id: number
  host_ip: string
  role_label: string | null
  created_at: string
}

export interface SystemHostCreate {
  host_ip: string
  role_label?: string
}
