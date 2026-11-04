import { useEffect, useState } from 'react'
import { agentsApi } from '@/api/agents'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '@/constants/queryKeys'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import { useMyPrimarySystems } from '@/hooks/queries/useMyPrimarySystems'
import type {
  AgentType,
  AgentInstance,
  OsType,
  ServerType,
  DbType,
  AgentTServiceType,
  WebServerLogFormat,
} from '@/types/agent'
import type { System } from '@/types/system'

export const AGENT_TYPES: { value: AgentType; label: string }[] = [
  { value: 'synapse_agent', label: 'Synapse 수집기' },
  { value: 'db', label: 'DB 수집기' },
  { value: 'agent_t', label: 'Agent-T (트랜잭션)' },
]

const GLOB_RE = /^[A-Za-z0-9/_\-.*?]+$/

const URI_ERROR = '포함/제외 URI 는 영문·숫자와 / _ - . * ? 만 사용할 수 있습니다 (쉼표로 구분).'

/** 쉼표 구분 glob 목록 정규화 (공백·빈 항목 제거) */
export function normalizeGlobs(v: string): string {
  return v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(',')
}

/** 각 항목이 허용 문자 [A-Za-z0-9/_\-.*?] 만 포함하는지 (빈 값 허용) */
export function validGlobs(v: string): boolean {
  return normalizeGlobs(v)
    .split(',')
    .filter(Boolean)
    .every((x) => GLOB_RE.test(x))
}

export const AGENT_T_SERVICE_TYPES: { value: AgentTServiceType; label: string }[] = [
  { value: 'tomcat', label: 'Tomcat (setenv.sh)' },
  { value: 'jboss', label: 'JBoss / WildFly (standalone.conf.d)' },
  { value: 'jeus', label: 'JEUS (domain.xml)' },
  { value: 'systemd', label: 'systemd (root 필요)' },
  { value: 'standalone', label: '독립 실행 (wrapper)' },
]

export const DB_TYPE_OPTIONS: {
  value: DbType
  label: string
  defaultPort: number
  idLabel: string
  idPlaceholder: string
}[] = [
  {
    value: 'oracle',
    label: 'Oracle',
    defaultPort: 1521,
    idLabel: 'Service Name',
    idPlaceholder: 'ORCL',
  },
  {
    value: 'postgresql',
    label: 'PostgreSQL',
    defaultPort: 5432,
    idLabel: 'Database',
    idPlaceholder: 'mydb',
  },
  { value: 'mssql', label: 'MSSQL', defaultPort: 1433, idLabel: 'Database', idPlaceholder: 'mydb' },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306, idLabel: 'Database', idPlaceholder: 'mydb' },
]

const DEFAULT_PATHS: Record<
  string,
  { install: string; config: string; pid: string; port: number }
> = {
  synapse_agent: {
    install: '~/synapse/agent-v',
    config: '~/synapse/config.toml',
    pid: '~/synapse/agent.pid',
    port: 0,
  },
  agent_t: {
    install: '~/agent-t',
    config: '',
    pid: '',
    port: 0,
  },
}

export const COLLECTOR_KEYS = [
  'cpu',
  'memory',
  'disk',
  'network',
  'process',
  'tcp_connections',
  'log_monitor',
  'heartbeat',
  'web_servers',
  'preprocessor',
] as const

export const DEFAULT_COLLECTORS: Record<string, boolean> = {
  cpu: true,
  memory: true,
  disk: true,
  network: true,
  process: true,
  tcp_connections: true,
  log_monitor: true,
  heartbeat: true,
  web_servers: false,
  preprocessor: false,
}

export interface LogMonitorForm {
  paths: string
  log_type: string
  keywords: string
}

export const WEB_SERVER_LOG_FORMATS: { value: WebServerLogFormat; label: string }[] = [
  { value: 'combined', label: 'combined' },
  { value: 'nginx_json', label: 'nginx_json' },
  { value: 'clf', label: 'clf' },
]

export interface WebServerForm {
  name: string
  display_name: string
  log_path: string
  log_format: WebServerLogFormat
  slow_threshold_ms: string
  was_services: string
}

export function makeDefaultWebServer(): WebServerForm {
  return {
    name: '',
    display_name: '',
    log_path: '',
    log_format: 'combined',
    slow_threshold_ms: '1000',
    was_services: '',
  }
}

export interface AgentFormState {
  selectedSystemId: number
  setSelectedSystemId: (id: number) => void
  agentType: AgentType
  host: string
  setHost: (v: string) => void
  installPath: string
  setInstallPath: (v: string) => void
  configPath: string
  setConfigPath: (v: string) => void
  pidFile: string
  setPidFile: (v: string) => void
  port: string
  setPort: (v: string) => void
  osType: OsType
  setOsType: (v: OsType) => void
  serverType: ServerType
  setServerType: (v: ServerType) => void
  // DB fields
  dbType: DbType
  dbIdentifier: string
  setDbIdentifier: (v: string) => void
  dbUsername: string
  setDbUsername: (v: string) => void
  dbPassword: string
  setDbPassword: (v: string) => void
  dbInterval: string
  setDbInterval: (v: string) => void
  dbInstanceRole: string
  setDbInstanceRole: (v: string) => void
  currentDbTypeOption: (typeof DB_TYPE_OPTIONS)[number]
  handleDbTypeChange: (val: string) => void
  // Synapse fields
  instanceRole: string
  setInstanceRole: (v: string) => void
  collectors: Record<string, boolean>
  toggleCollector: (key: string) => void
  logMonitors: LogMonitorForm[]
  addLogMonitor: () => void
  removeLogMonitor: (idx: number) => void
  updateLogMonitor: (idx: number, field: keyof LogMonitorForm, value: string) => void
  webServers: WebServerForm[]
  addWebServer: () => void
  removeWebServer: (idx: number) => void
  updateWebServer: <K extends keyof WebServerForm>(
    idx: number,
    field: K,
    value: WebServerForm[K],
  ) => void
  // SSH 계정 (synapse_agent / agent_t 전용)
  sshUsername: string
  setSshUsername: (v: string) => void
  // Agent-T fields (설치 경로는 installPath, 역할은 instanceRole 공유)
  jvmMatch: string
  setJvmMatch: (v: string) => void
  agentTServiceType: AgentTServiceType
  setAgentTServiceType: (v: AgentTServiceType) => void
  agentTServicePath: string
  setAgentTServicePath: (v: string) => void
  immediate: boolean
  setImmediate: (v: boolean) => void
  permanent: boolean
  setPermanent: (v: boolean) => void
  jeusConfirm: boolean
  setJeusConfirm: (v: boolean) => void
  captureParams: boolean
  setCaptureParams: (v: boolean) => void
  captureParamsInclude: string
  setCaptureParamsInclude: (v: string) => void
  captureParamsExclude: string
  setCaptureParamsExclude: (v: string) => void
  // Submit
  error: string | null
  loading: boolean
  handleTypeChange: (val: string) => void
  handleSubmit: (e: React.FormEvent) => Promise<void>
}

export function useAgentFormLogic(
  systems: System[],
  onCreated: (agent: AgentInstance) => void,
): AgentFormState {
  const qc = useQueryClient()
  const sshSession = useSSHSessionStore()
  const sessionActive = sshSession.isValid()
  const { data: primarySystems } = useMyPrimarySystems()

  const [selectedSystemId, setSelectedSystemId] = useState<number>(0)
  const [agentType, setAgentType] = useState<AgentType>('synapse_agent')
  const [host, setHost] = useState(sessionActive && sshSession.host ? sshSession.host : '')
  const [installPath, setInstallPath] = useState(DEFAULT_PATHS.synapse_agent.install)
  const [configPath, setConfigPath] = useState(DEFAULT_PATHS.synapse_agent.config)
  const [pidFile, setPidFile] = useState(DEFAULT_PATHS.synapse_agent.pid)
  const [port, setPort] = useState<string>('')

  const [osType, setOsType] = useState<OsType>('linux')
  const [serverType, setServerType] = useState<ServerType>('was')

  // DB fields
  const [dbType, setDbType] = useState<DbType>('oracle')
  const [dbIdentifier, setDbIdentifier] = useState('')
  const [dbUsername, setDbUsername] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [dbInterval, setDbInterval] = useState('60')
  const [dbInstanceRole, setDbInstanceRole] = useState('db-primary')

  // Synapse fields
  const [instanceRole, setInstanceRole] = useState('')
  const [collectors, setCollectors] = useState<Record<string, boolean>>({ ...DEFAULT_COLLECTORS })
  const [logMonitors, setLogMonitors] = useState<LogMonitorForm[]>([
    { paths: '', log_type: 'app', keywords: 'ERROR, CRITICAL, PANIC, Fatal, Exception' },
  ])
  const [webServers, setWebServers] = useState<WebServerForm[]>([])

  // SSH 계정 (synapse_agent / agent_t 전용)
  const [sshUsername, setSshUsername] = useState('')

  // Agent-T fields
  const [jvmMatch, setJvmMatch] = useState('')
  const [agentTServiceType, setAgentTServiceType] = useState<AgentTServiceType>('standalone')
  const [agentTServicePath, setAgentTServicePath] = useState('')
  const [immediate, setImmediate] = useState(true)
  const [permanent, setPermanent] = useState(true)
  const [jeusConfirm, setJeusConfirm] = useState(false)
  const [captureParams, setCaptureParams] = useState(false)
  const [captureParamsInclude, setCaptureParamsIncludeRaw] = useState('')
  const [captureParamsExclude, setCaptureParamsExcludeRaw] = useState('')

  const [error, setError] = useState<string | null>(null)
  // URI 입력을 고치면 그 자리에서 다시 검증해, 값이 유효해지면 URI 오류를 바로 지운다
  const clearUriErrorIfValid = (include: string, exclude: string) => {
    if (validGlobs(include) && validGlobs(exclude)) {
      setError((e) => (e === URI_ERROR ? null : e))
    }
  }
  const setCaptureParamsInclude = (v: string) => {
    setCaptureParamsIncludeRaw(v)
    clearUriErrorIfValid(v, captureParamsExclude)
  }
  const setCaptureParamsExclude = (v: string) => {
    setCaptureParamsExcludeRaw(v)
    clearUriErrorIfValid(captureParamsInclude, v)
  }
  const [loading, setLoading] = useState(false)

  const currentDbTypeOption = DB_TYPE_OPTIONS.find((o) => o.value === dbType) ?? DB_TYPE_OPTIONS[0]

  // Auto-select first primary system
  useEffect(() => {
    if (selectedSystemId !== 0) return
    if (!primarySystems || primarySystems.length === 0) return
    const first = primarySystems[0]
    if (systems.some((s) => s.id === first.system_id)) {
      setSelectedSystemId(first.system_id)
    }
  }, [primarySystems, systems, selectedSystemId])

  // Auto-add default web server entry when web_servers collector is toggled on
  useEffect(() => {
    if (collectors.web_servers && webServers.length === 0) {
      setWebServers([makeDefaultWebServer()])
    }
  }, [collectors.web_servers, webServers.length])

  function handleTypeChange(val: string) {
    const t = val as AgentType
    setAgentType(t)
    const defaults = DEFAULT_PATHS[t] ?? DEFAULT_PATHS.synapse_agent
    setInstallPath(defaults.install)
    setConfigPath(defaults.config)
    setPidFile(defaults.pid)
    setPort(defaults.port > 0 ? String(defaults.port) : '')
  }

  function handleDbTypeChange(val: string) {
    const dt = val as DbType
    setDbType(dt)
    const opt = DB_TYPE_OPTIONS.find((o) => o.value === dt)
    if (opt) {
      setPort(String(opt.defaultPort))
    }
    setDbIdentifier('')
  }

  function toggleCollector(key: string) {
    setCollectors((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function addLogMonitor() {
    setLogMonitors((prev) => [
      ...prev,
      { paths: '', log_type: 'app', keywords: 'ERROR, CRITICAL, PANIC, Fatal, Exception' },
    ])
  }

  function removeLogMonitor(idx: number) {
    setLogMonitors((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateLogMonitor(idx: number, field: keyof LogMonitorForm, value: string) {
    setLogMonitors((prev) => prev.map((lm, i) => (i === idx ? { ...lm, [field]: value } : lm)))
  }

  function addWebServer() {
    setWebServers((prev) => [...prev, makeDefaultWebServer()])
  }

  function removeWebServer(idx: number) {
    setWebServers((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateWebServer<K extends keyof WebServerForm>(
    idx: number,
    field: K,
    value: WebServerForm[K],
  ) {
    setWebServers((prev) => prev.map((ws, i) => (i === idx ? { ...ws, [field]: value } : ws)))
  }

  function buildLabelInfo(): string {
    if (agentType === 'db') {
      const idKey = dbType === 'oracle' ? 'service_name' : 'database'
      return JSON.stringify({
        db_type: dbType,
        [idKey]: dbIdentifier,
        username: dbUsername,
        password: dbPassword,
        instance_role: dbInstanceRole || 'db-primary',
        collect_interval_secs: Math.max(10, Number(dbInterval) || 60),
      })
    }
    if (agentType === 'agent_t') {
      return JSON.stringify({
        jvm_match: jvmMatch.trim(),
        instance_role: instanceRole || undefined,
        service_type: agentTServiceType,
        service_path: agentTServicePath || undefined,
        install_dir: installPath,
        immediate,
        permanent,
        ...(agentTServiceType === 'jeus' ? { jeus_confirm: jeusConfirm } : {}),
        capture_params: captureParams,
        ...(captureParams && captureParamsInclude.trim()
          ? { capture_params_include: normalizeGlobs(captureParamsInclude) }
          : {}),
        ...(captureParams && captureParamsExclude.trim()
          ? { capture_params_exclude: normalizeGlobs(captureParamsExclude) }
          : {}),
      })
    }
    const system = systems.find((s) => s.id === selectedSystemId)
    if (agentType !== 'synapse_agent' || !system) return ''
    const info: Record<string, unknown> = {
      system_name: system.system_name,
      display_name: system.display_name,
      instance_role: instanceRole || 'default',
      collectors,
      log_monitors: logMonitors.map((lm) => ({
        paths: lm.paths
          .split('\n')
          .map((p) => p.trim())
          .filter(Boolean),
        log_type: lm.log_type || 'app',
        keywords: lm.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      })),
    }
    if (collectors.web_servers) {
      info.web_servers = webServers
        .map((ws) => ({
          name: ws.name.trim(),
          display_name: (ws.display_name || ws.name).trim(),
          log_path: ws.log_path.trim(),
          log_format: ws.log_format,
          slow_threshold_ms: Math.max(1, Number(ws.slow_threshold_ms) || 1000),
          was_services: ws.was_services
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }))
        .filter((ws) => ws.name && ws.log_path)
    }
    return JSON.stringify(info)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!selectedSystemId || selectedSystemId === 0) {
      setError('시스템을 선택하세요.')
      return
    }
    const isDb = agentType === 'db'
    const isAgentTSubmit = agentType === 'agent_t'
    if (isAgentTSubmit && !jvmMatch.trim()) {
      setError('대상 JVM 식별 문자열(jvm_match)을 입력하세요.')
      return
    }
    if (isAgentTSubmit && captureParams) {
      const bad = [captureParamsInclude, captureParamsExclude].some((v) => !validGlobs(v))
      if (bad) {
        setError(URI_ERROR)
        return
      }
    }
    setLoading(true)
    if (!isDb && !sshUsername.trim()) {
      setError('SSH 계정(OS 사용자명)을 입력하세요.')
      setLoading(false)
      return
    }
    try {
      const agent = await agentsApi.createAgent({
        system_id: selectedSystemId,
        host,
        agent_type: agentType,
        ...(isDb
          ? {}
          : isAgentTSubmit
            ? { install_path: installPath }
            : { install_path: installPath, config_path: configPath }),
        pid_file: isAgentTSubmit ? undefined : pidFile || undefined,
        ...(!isDb ? { ssh_username: sshUsername.trim() } : {}),
        port: isDb
          ? port
            ? Number(port)
            : currentDbTypeOption.defaultPort
          : port
            ? Number(port)
            : undefined,
        label_info: buildLabelInfo() || undefined,
        os_type: osType,
        server_type: serverType,
      })
      await qc.invalidateQueries({ queryKey: qk.agents() })
      onCreated(agent)
    } catch (err) {
      let msg = '에이전트 등록에 실패했습니다.'
      try {
        const body = await (err as { response?: Response }).response?.json()
        if (body?.detail) msg = body.detail
      } catch {
        // json 파싱 실패 시 기본 메시지 유지
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return {
    selectedSystemId,
    setSelectedSystemId,
    agentType,
    host,
    setHost,
    installPath,
    setInstallPath,
    configPath,
    setConfigPath,
    pidFile,
    setPidFile,
    port,
    setPort,
    osType,
    setOsType,
    serverType,
    setServerType,
    dbType,
    dbIdentifier,
    setDbIdentifier,
    dbUsername,
    setDbUsername,
    dbPassword,
    setDbPassword,
    dbInterval,
    setDbInterval,
    dbInstanceRole,
    setDbInstanceRole,
    currentDbTypeOption,
    handleDbTypeChange,
    instanceRole,
    setInstanceRole,
    collectors,
    toggleCollector,
    logMonitors,
    addLogMonitor,
    removeLogMonitor,
    updateLogMonitor,
    webServers,
    addWebServer,
    removeWebServer,
    updateWebServer,
    sshUsername,
    setSshUsername,
    jvmMatch,
    setJvmMatch,
    agentTServiceType,
    setAgentTServiceType,
    agentTServicePath,
    setAgentTServicePath,
    immediate,
    setImmediate,
    permanent,
    setPermanent,
    jeusConfirm,
    setJeusConfirm,
    captureParams,
    setCaptureParams,
    captureParamsInclude,
    setCaptureParamsInclude,
    captureParamsExclude,
    setCaptureParamsExclude,
    error,
    loading,
    handleTypeChange,
    handleSubmit,
  }
}
