export interface SslHaGroup {
  id: number
  group_name: string
  system_code: string | null
  serial_size: number
  created_at: string
}

export interface SslServer {
  id: number
  system_code: string
  system_name: string
  host: string
  account: string
  instance_role: string | null
  web_type: string
  cert_type: string
  domain: string | null
  config_file: string | null
  cert_dir: string | null
  webtob_home: string | null
  ssh_port: number
  ha_group_id: number | null
  serial_order: number
  network_zone: string
  status: string
  created_at: string
  updated_at: string
}

export interface SslServerCreate {
  system_code: string
  system_name: string
  host: string
  account: string
  password: string
  instance_role?: string
  web_type: string
  cert_type?: string
  domain?: string
  config_file?: string
  cert_dir?: string
  webtob_home?: string
  ssh_port?: number
  ha_group_id?: number | null
  serial_order?: number
  network_zone?: string
}

export interface SslServerUpdate {
  system_code?: string
  system_name?: string
  instance_role?: string
  web_type?: string
  cert_type?: string
  domain?: string
  config_file?: string
  cert_dir?: string
  webtob_home?: string
  ssh_port?: number
  ha_group_id?: number | null
  serial_order?: number
  network_zone?: string
  status?: string
}

export interface SslDeployment {
  id: number
  server_id: number | null
  trigger_type: string
  cert_type: string | null
  cert_expiry: string | null
  status: string
  duration_sec: number | null
  deploy_log: string | null
  steps_result: string | null
  rule_analysis: string | null
  llm_analysis: string | null
  deployed_at: string
}

export interface SslCertSnapshot {
  id: number
  server_id: number | null
  expiry_date: string | null
  days_left: number | null
  is_valid: boolean | null
  checked_at: string
}

export interface SslCertStatus {
  server: SslServer
  snapshot: SslCertSnapshot | null
}

export interface RootCaInfo {
  available: boolean
  subject?: string
  not_after?: string
  fingerprint_sha256?: string
  error?: string
}
