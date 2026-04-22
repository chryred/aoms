export type AgentType = 'synapse_agent' | 'db' | 'otel_javaagent'

export type OtelServiceType = 'tomcat' | 'jboss' | 'jeus' | 'systemd' | 'standalone'

export interface OtelAgentLabelInfo {
  tempo_service_name: string
  service_type: OtelServiceType
  jdk_version: string
  install_path: string
}

export type DbType = 'oracle' | 'postgresql' | 'mssql' | 'mysql'

export interface LogMonitorEntry {
  paths: string[]
  keywords: string[]
  log_type: string
}

export type WebServerLogFormat = 'combined' | 'nginx_json' | 'clf'

export interface WebServerEntry {
  name: string
  display_name: string
  log_path: string
  log_format: WebServerLogFormat
  slow_threshold_ms: number
  was_services: string[]
}

export interface SynapseAgentLabelInfo {
  system_name: string
  display_name: string
  instance_role: string
  collectors: Record<string, boolean>
  log_monitors: LogMonitorEntry[]
  web_servers?: WebServerEntry[]
}
export type AgentStatus = 'installed' | 'running' | 'stopped' | 'unknown'
export type InstallJobStatus = 'pending' | 'running' | 'done' | 'failed'

export type OsType = 'linux' | 'windows'
export type ServerType = 'web' | 'was' | 'db' | 'middleware' | 'other'

export interface AgentInstance {
  id: number
  system_id: number
  host: string
  agent_type: AgentType
  install_path: string | null // db 에이전트는 null
  config_path: string | null // db 에이전트는 null
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
  agent_type: AgentType
  install_path?: string // db 에이전트는 불필요
  config_path?: string // db 에이전트는 불필요
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
