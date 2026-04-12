export type AgentType = 'alloy' | 'node_exporter' | 'jmx_exporter' | 'synapse_agent' | 'oracle_db'

export interface LogMonitorEntry {
  paths: string[]
  keywords: string[]
  log_type: string
}

export interface SynapseAgentLabelInfo {
  system_name: string
  display_name: string
  instance_role: string
  collectors: Record<string, boolean>
  log_monitors: LogMonitorEntry[]
}
export type AgentStatus = 'installed' | 'running' | 'stopped' | 'unknown'
export type InstallJobStatus = 'pending' | 'running' | 'done' | 'failed'

export type OsType = 'linux' | 'windows'
export type ServerType = 'web' | 'was' | 'db' | 'middleware' | 'other'

export interface AgentInstance {
  id: number
  system_id: number
  host: string
  ssh_username: string | null // oracle_db는 null
  agent_type: AgentType
  install_path: string | null // oracle_db는 null
  config_path: string | null // oracle_db는 null
  port: number | null
  pid_file: string | null
  label_info: string | null
  os_type: OsType | null
  server_type: ServerType | null
  status: AgentStatus
  created_at: string
  updated_at: string
}

export interface AgentInstanceCreate {
  system_id: number
  host: string
  ssh_username?: string // oracle_db는 불필요
  agent_type: AgentType
  install_path?: string // oracle_db는 불필요
  config_path?: string // oracle_db는 불필요
  port?: number
  pid_file?: string
  label_info?: string
  os_type?: OsType
  server_type?: ServerType
}

export interface AgentInstanceUpdate {
  install_path?: string
  config_path?: string
  port?: number
  pid_file?: string
  label_info?: string
  status?: AgentStatus
  ssh_username?: string
  os_type?: OsType
  server_type?: ServerType
}

export interface SSHSessionCreate {
  host: string
  port?: number
  username: string
  password: string
}

export interface SSHSessionOut {
  session_token: string
  host: string
  port: number
  username: string
  expires_in: number
}

export interface AgentInstallRequest {
  agent_id: number
}

export interface AgentInstallJob {
  job_id: string
  agent_id: number | null
  status: InstallJobStatus
  logs: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface AgentStatusOut {
  agent_id: number
  status: AgentStatus
  pid: number | null
  message: string
}

export interface AgentConfigResponse {
  agent_id: number
  config_path: string
  content: string
}

export type AgentLiveStatus = 'collecting' | 'delayed' | 'stale' | 'no_data'

export interface AgentLiveStatusOut {
  agent_id: number
  type: AgentType
  status: AgentStatus
  live: boolean
  live_status?: AgentLiveStatus
  last_seen?: string | null
  collectors_active?: string[]
}

export interface AgentHealthSummary {
  total: number
  collecting: number
  stale: number
}
