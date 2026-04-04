export type OsType = 'linux' | 'windows'
export type SystemType = 'web' | 'was' | 'db' | 'middleware' | 'other'
export type SystemStatus = 'active' | 'inactive'

export interface System {
  id: number
  system_name: string
  display_name: string
  description: string | null
  host: string
  os_type: OsType
  system_type: SystemType
  status: SystemStatus
  teams_webhook_url: string | null
  created_at: string
  updated_at: string
}

export interface SystemCreate {
  system_name: string
  display_name: string
  description?: string
  host: string
  os_type: OsType
  system_type: SystemType
  status?: SystemStatus
  teams_webhook_url?: string
}

export type SystemUpdate = Partial<Omit<SystemCreate, 'system_name'>>
