export type AgentType = 'alloy' | 'node_exporter' | 'jmx_exporter' | 'synapse_agent'
export type AgentStatus = 'installed' | 'running' | 'stopped' | 'unknown'
export type InstallJobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface AgentInstance {
  id: number
  system_id: number
  host: string
  ssh_username: string
  agent_type: AgentType
  install_path: string
  config_path: string
  port: number | null
  pid_file: string | null
  label_info: string | null
  status: AgentStatus
  created_at: string
  updated_at: string
}

export interface AgentInstanceCreate {
  system_id: number
  host: string
  ssh_username: string
  agent_type: AgentType
  install_path: string
  config_path: string
  port?: number
  pid_file?: string
  label_info?: string
}

export interface AgentInstanceUpdate {
  install_path?: string
  config_path?: string
  port?: number
  pid_file?: string
  label_info?: string
  status?: AgentStatus
  ssh_username?: string
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
  binary_url?: string
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
