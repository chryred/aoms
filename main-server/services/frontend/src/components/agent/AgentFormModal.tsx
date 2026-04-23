import { useEffect, useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuInput } from '@/components/neumorphic/NeuInput'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuCard } from '@/components/neumorphic/NeuCard'
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
  OtelServiceType,
  WebServerLogFormat,
} from '@/types/agent'
import type { System } from '@/types/system'

const AGENT_TYPES: { value: AgentType; label: string }[] = [
  { value: 'synapse_agent', label: 'Synapse 수집기' },
  { value: 'db', label: 'DB 수집기' },
  { value: 'otel_javaagent', label: 'OTel Java 수집기' },
]

const OTEL_SERVICE_TYPES: { value: OtelServiceType; label: string }[] = [
  { value: 'tomcat', label: 'Tomcat (setenv.sh)' },
  { value: 'jboss', label: 'JBoss / WildFly (standalone.conf.d)' },
  { value: 'jeus', label: 'JEUS (otel.sh)' },
  { value: 'systemd', label: 'systemd (root 필요)' },
  { value: 'standalone', label: '독립 실행 (otel-launch.sh)' },
]

const DB_TYPE_OPTIONS: {
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
  otel_javaagent: {
    install: '~/otel',
    config: '~/otel/otel-env.sh',
    pid: '',
    port: 0,
  },
}

const COLLECTOR_KEYS = [
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

const DEFAULT_COLLECTORS: Record<string, boolean> = {
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

interface LogMonitorForm {
  paths: string
  log_type: string
  keywords: string
}

const WEB_SERVER_LOG_FORMATS: { value: WebServerLogFormat; label: string }[] = [
  { value: 'combined', label: 'combined' },
  { value: 'nginx_json', label: 'nginx_json' },
  { value: 'clf', label: 'clf' },
]

interface WebServerForm {
  name: string
  display_name: string
  log_path: string
  log_format: WebServerLogFormat
  slow_threshold_ms: string
  was_services: string
}

function makeDefaultWebServer(): WebServerForm {
  return {
    name: '',
    display_name: '',
    log_path: '',
    log_format: 'combined',
    slow_threshold_ms: '1000',
    was_services: '',
  }
}

interface AgentFormModalProps {
  systems: System[]
  onClose: () => void
  onCreated: (agent: AgentInstance) => void
}

export function AgentFormModal({ systems, onClose, onCreated }: AgentFormModalProps) {
  const qc = useQueryClient()
  const sshSession = useSSHSessionStore()
  const sessionActive = sshSession.isValid()
  const { data: primarySystems } = useMyPrimarySystems()
  // 0 = 미선택(placeholder). 로그인 사용자가 primary 담당인 시스템이 있으면 자동 선택
  const [selectedSystemId, setSelectedSystemId] = useState<number>(0)
  const [agentType, setAgentType] = useState<AgentType>('synapse_agent')
  const [host, setHost] = useState(sessionActive && sshSession.host ? sshSession.host : '')
  const [installPath, setInstallPath] = useState(DEFAULT_PATHS.synapse_agent.install)
  const [configPath, setConfigPath] = useState(DEFAULT_PATHS.synapse_agent.config)
  const [pidFile, setPidFile] = useState(DEFAULT_PATHS.synapse_agent.pid)
  const [port, setPort] = useState<string>('')

  const [osType, setOsType] = useState<OsType>('linux')
  const [serverType, setServerType] = useState<ServerType>('was')

  // db 에이전트 전용 필드
  const [dbType, setDbType] = useState<DbType>('oracle')
  const [dbIdentifier, setDbIdentifier] = useState('')
  const [dbUsername, setDbUsername] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [dbInterval, setDbInterval] = useState('60')
  const [dbInstanceRole, setDbInstanceRole] = useState('db-primary')

  // synapse_agent 전용 필드
  const [instanceRole, setInstanceRole] = useState('')
  const [collectors, setCollectors] = useState<Record<string, boolean>>({ ...DEFAULT_COLLECTORS })
  const [logMonitors, setLogMonitors] = useState<LogMonitorForm[]>([
    { paths: '', log_type: 'app', keywords: 'ERROR, CRITICAL, PANIC, Fatal, Exception' },
  ])
  const [webServers, setWebServers] = useState<WebServerForm[]>([])

  // 로그인 사용자가 primary 담당인 시스템이 있으면 자동 선택 (첫 번째)
  useEffect(() => {
    if (selectedSystemId !== 0) return
    if (!primarySystems || primarySystems.length === 0) return
    const first = primarySystems[0]
    // systems 목록에 존재하는 경우에만 선택
    if (systems.some((s) => s.id === first.system_id)) {
      setSelectedSystemId(first.system_id)
    }
  }, [primarySystems, systems, selectedSystemId])

  // web_servers 체크 시 엔트리 0개면 기본 1개 자동 추가
  useEffect(() => {
    if (collectors.web_servers && webServers.length === 0) {
      setWebServers([makeDefaultWebServer()])
    }
  }, [collectors.web_servers, webServers.length])

  // otel_javaagent 전용 필드
  const [otelServiceName, setOtelServiceName] = useState('')
  const [otelServiceType, setOtelServiceType] = useState<OtelServiceType>('standalone')
  const [otelJdkVersion, setOtelJdkVersion] = useState('17')
  const [otelServicePath, setOtelServicePath] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const currentDbTypeOption = DB_TYPE_OPTIONS.find((o) => o.value === dbType) ?? DB_TYPE_OPTIONS[0]

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
        password: dbPassword, // 서버에서 Fernet 암호화 후 저장
        instance_role: dbInstanceRole || 'db-primary',
        collect_interval_secs: Math.max(10, Number(dbInterval) || 60),
      })
    }
    if (agentType === 'otel_javaagent') {
      const system = systems.find((s) => s.id === selectedSystemId)
      return JSON.stringify({
        tempo_service_name: otelServiceName || system?.system_name || '',
        service_type: otelServiceType,
        jdk_version: otelJdkVersion,
        install_path: installPath,
        service_path: otelServicePath || undefined,
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
    setLoading(true)
    const isDb = agentType === 'db'
    const isOtelSubmit = agentType === 'otel_javaagent'
    try {
      const agent = await agentsApi.createAgent({
        system_id: selectedSystemId,
        host,
        agent_type: agentType,
        ...(isDb
          ? {}
          : isOtelSubmit
            ? { install_path: installPath }
            : { install_path: installPath, config_path: configPath }),
        pid_file: isOtelSubmit ? undefined : pidFile || undefined,
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
        // ky HTTPError — 서버가 보낸 detail 메시지를 그대로 표시
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

  const isSynapse = agentType === 'synapse_agent'
  const isDb = agentType === 'db'
  const isOtel = agentType === 'otel_javaagent'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-overlay absolute inset-0 z-0" onClick={onClose} />
      <NeuCard className="relative z-10 mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-text-primary text-base font-semibold">에이전트 등록</h3>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm focus:ring-1 focus:outline-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* 기본 정보 */}
          <div>
            <label className="text-text-secondary mb-1 block text-xs">시스템</label>
            <NeuSelect
              value={selectedSystemId}
              onChange={(e) => setSelectedSystemId(Number(e.target.value))}
              required
            >
              <option value={0} disabled>
                선택
              </option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name} ({s.system_name})
                </option>
              ))}
            </NeuSelect>
          </div>
          <div>
            <label className="text-text-secondary mb-1 block text-xs">에이전트 타입</label>
            <NeuSelect value={agentType} onChange={(e) => handleTypeChange(e.target.value)}>
              {AGENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </NeuSelect>
          </div>
          <div>
            <label className="text-text-secondary mb-1 block text-xs">
              {isDb ? 'SCAN 주소 / 호스트명' : '서버 IP'}
            </label>
            <NeuInput
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={isDb ? 'scan.example.com' : '10.0.0.1'}
              required
            />
            {!isDb && sessionActive && sshSession.host && host && host !== sshSession.host && (
              <p className="text-warning mt-1 text-xs">
                SSH 세션 호스트({sshSession.host})와 다릅니다. 에이전트 제어 시 오류가 발생할 수
                있습니다.
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-text-secondary mb-1 block text-xs">OS</label>
              <NeuSelect value={osType} onChange={(e) => setOsType(e.target.value as OsType)}>
                <option value="linux">Linux</option>
                <option value="windows">Windows</option>
              </NeuSelect>
            </div>
            <div className="flex-1">
              <label className="text-text-secondary mb-1 block text-xs">서버 역할</label>
              <NeuSelect
                value={serverType}
                onChange={(e) => setServerType(e.target.value as ServerType)}
              >
                <option value="web">Web</option>
                <option value="was">WAS</option>
                <option value="db">DB</option>
                <option value="middleware">Middleware</option>
                <option value="other">기타</option>
              </NeuSelect>
            </div>
          </div>

          {/* db 에이전트 전용 필드 */}
          {isDb && (
            <div className="border-border bg-bg-deep space-y-3 rounded-sm border p-3">
              <p className="text-text-secondary text-xs font-medium">DB 연결 설정</p>
              <div>
                <label className="text-text-secondary mb-1 block text-xs">DB 타입</label>
                <NeuSelect value={dbType} onChange={(e) => handleDbTypeChange(e.target.value)}>
                  {DB_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </NeuSelect>
              </div>
              <div>
                <label className="text-text-secondary mb-1 block text-xs">
                  instance_role{' '}
                  <span className="text-text-secondary/60">
                    (HA 구분: db-primary, db-standby …)
                  </span>
                </label>
                <NeuInput
                  value={dbInstanceRole}
                  onChange={(e) => setDbInstanceRole(e.target.value)}
                  placeholder="db-primary"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-text-secondary mb-1 block text-xs">
                    {currentDbTypeOption.idLabel}
                  </label>
                  <NeuInput
                    value={dbIdentifier}
                    onChange={(e) => setDbIdentifier(e.target.value)}
                    placeholder={currentDbTypeOption.idPlaceholder}
                    required
                  />
                </div>
                <div className="w-24">
                  <label className="text-text-secondary mb-1 block text-xs">포트</label>
                  <NeuInput
                    type="number"
                    value={port || String(currentDbTypeOption.defaultPort)}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder={String(currentDbTypeOption.defaultPort)}
                  />
                </div>
              </div>
              <div>
                <label className="text-text-secondary mb-1 block text-xs">DB 계정</label>
                <NeuInput
                  value={dbUsername}
                  onChange={(e) => setDbUsername(e.target.value)}
                  placeholder="monitor"
                  required
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-text-secondary mb-1 block text-xs">DB 패스워드</label>
                  <NeuInput
                    type="password"
                    value={dbPassword}
                    onChange={(e) => setDbPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="w-28">
                  <label className="text-text-secondary mb-1 block text-xs">수집 주기(초)</label>
                  <NeuInput
                    type="number"
                    value={dbInterval}
                    onChange={(e) => setDbInterval(e.target.value)}
                    placeholder="60"
                    min="10"
                  />
                </div>
              </div>
            </div>
          )}

          {/* synapse_agent 전용: instance_role */}
          {isSynapse && (
            <div>
              <label className="text-text-secondary mb-1 block text-xs">
                instance_role{' '}
                <span className="text-text-secondary/60">(HA 구분: was1, was2, db-primary …)</span>
              </label>
              <NeuInput
                value={instanceRole}
                onChange={(e) => setInstanceRole(e.target.value)}
                placeholder="was1"
              />
            </div>
          )}

          {/* 경로 — db 에이전트는 바이너리/설정/PID 불필요, OTel은 설치 경로만 */}
          {isSynapse && (
            <>
              <div>
                <label className="text-text-secondary mb-1 block text-xs">바이너리 경로</label>
                <NeuInput
                  value={installPath}
                  onChange={(e) => setInstallPath(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-text-secondary mb-1 block text-xs">
                  설정 파일 경로
                  <span className="text-text-secondary/60"> (자동 생성)</span>
                </label>
                <NeuInput value={configPath} onChange={(e) => setConfigPath(e.target.value)} />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-text-secondary mb-1 block text-xs">PID 파일 경로</label>
                  <NeuInput value={pidFile} onChange={(e) => setPidFile(e.target.value)} />
                </div>
              </div>
            </>
          )}

          {/* otel_javaagent 전용 필드 */}
          {isOtel && (
            <div className="border-border bg-bg-deep space-y-3 rounded-sm border p-3">
              <p className="text-text-secondary text-xs font-medium">OTel Java 수집기 설정</p>
              <p className="text-text-secondary/70 text-[11px] leading-relaxed">
                WAS 기동 계정으로 SSH 접속하여 사용자 홈 디렉토리에 설치합니다. systemd 시스템
                모드만 root가 필요합니다.
              </p>
              <div>
                <label className="text-text-secondary mb-1 block text-xs">설치 경로</label>
                <NeuInput
                  value={installPath}
                  onChange={(e) => setInstallPath(e.target.value)}
                  placeholder="~/otel"
                  required
                />
              </div>
              <div>
                <label className="text-text-secondary mb-1 block text-xs">
                  Tempo 서비스명{' '}
                  <span className="text-text-secondary/60">(비워두면 system_name 사용)</span>
                </label>
                <NeuInput
                  value={otelServiceName}
                  onChange={(e) => setOtelServiceName(e.target.value)}
                  placeholder={
                    systems.find((s) => s.id === selectedSystemId)?.system_name ?? 'service-name'
                  }
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-text-secondary mb-1 block text-xs">서비스 유형</label>
                  <NeuSelect
                    value={otelServiceType}
                    onChange={(e) => setOtelServiceType(e.target.value as OtelServiceType)}
                  >
                    {OTEL_SERVICE_TYPES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NeuSelect>
                </div>
                <div className="w-36">
                  <label className="text-text-secondary mb-1 block text-xs">JDK 버전</label>
                  <NeuSelect
                    value={otelJdkVersion}
                    onChange={(e) => setOtelJdkVersion(e.target.value)}
                  >
                    <option value="8">JDK 8 (v1.33.x)</option>
                    <option value="11">JDK 11+ (v2.x)</option>
                    <option value="17">JDK 17+ (v2.x)</option>
                    <option value="21">JDK 21+ (v2.x)</option>
                  </NeuSelect>
                </div>
              </div>
              {(otelServiceType === 'tomcat' ||
                otelServiceType === 'jboss' ||
                otelServiceType === 'jeus') && (
                <div>
                  <label className="text-text-secondary mb-1 block text-xs">
                    WAS 설치 경로{' '}
                    <span className="text-text-secondary/60">(env 주입 대상 서비스 경로)</span>
                  </label>
                  <NeuInput
                    value={otelServicePath}
                    onChange={(e) => setOtelServicePath(e.target.value)}
                    placeholder={
                      otelServiceType === 'tomcat'
                        ? '~/tomcat'
                        : otelServiceType === 'jboss'
                          ? '~/jboss'
                          : '~/jeus'
                    }
                    required
                  />
                </div>
              )}
            </div>
          )}

          {/* synapse_agent 전용: 수집기 선택 */}
          {isSynapse && (
            <div>
              <label className="text-text-secondary mb-2 block text-xs">수집항목</label>
              <div className="grid grid-cols-2 gap-1">
                {COLLECTOR_KEYS.map((key) => (
                  <label
                    key={key}
                    className="hover:bg-surface flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={collectors[key] ?? false}
                      onChange={() => toggleCollector(key)}
                      className="accent-[#00D4FF]"
                    />
                    <span className="text-text-tertiary text-xs">{key}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* synapse_agent 전용: log_monitor 목록 (log_monitor 체크 시 활성) */}
          {isSynapse && (
            <div aria-disabled={!collectors.log_monitor}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-text-secondary text-xs">로그 수집 설정</label>
                  {!collectors.log_monitor && (
                    <span className="text-text-tertiary text-xs">log_monitor 체크 시 활성</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={addLogMonitor}
                  disabled={!collectors.log_monitor}
                  className="text-accent hover:text-accent/80 flex items-center gap-1 text-xs disabled:cursor-not-allowed"
                >
                  <Plus className="h-3 w-3" />
                  추가
                </button>
              </div>
              <div
                className={`space-y-2 transition-opacity duration-[400ms] ease-in-out ${
                  collectors.log_monitor ? 'opacity-100' : 'pointer-events-none opacity-40'
                }`}
              >
                {logMonitors.map((lm, idx) => (
                  <div
                    key={idx}
                    className="border-border bg-bg-deep space-y-2 rounded-sm border p-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-text-secondary text-xs">로그 소스 #{idx + 1}</span>
                      {logMonitors.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLogMonitor(idx)}
                          disabled={!collectors.log_monitor}
                          className="text-text-secondary hover:text-critical disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div>
                      <label className="text-text-secondary/70 mb-1 block text-xs">
                        경로 (한 줄에 하나)
                      </label>
                      <textarea
                        value={lm.paths}
                        onChange={(e) => updateLogMonitor(idx, 'paths', e.target.value)}
                        placeholder={'/server1/JeusServer.log\n/batch/JeusServer.log'}
                        rows={2}
                        disabled={!collectors.log_monitor}
                        className="border-border bg-bg-base text-text-primary placeholder-text-secondary/50 focus:border-accent focus:ring-accent w-full resize-none rounded-sm border px-2 py-1 text-xs focus:ring-1 focus:outline-none disabled:cursor-not-allowed pointer-events-auto"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="w-28">
                        <label className="text-text-secondary/70 mb-1 block text-xs">
                          log_type
                        </label>
                        <NeuInput
                          value={lm.log_type}
                          onChange={(e) => updateLogMonitor(idx, 'log_type', e.target.value)}
                          placeholder="app"
                          disabled={!collectors.log_monitor}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-text-secondary/70 mb-1 block text-xs">
                          keywords (쉼표 구분)
                        </label>
                        <NeuInput
                          value={lm.keywords}
                          onChange={(e) => updateLogMonitor(idx, 'keywords', e.target.value)}
                          placeholder="ERROR, CRITICAL"
                          disabled={!collectors.log_monitor}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* synapse_agent 전용: web_servers 아코디언 (web_servers 체크 시 펼침, 400ms) */}
          {isSynapse && (
            <div
              className={`overflow-hidden transition-all duration-[400ms] ease-in-out ${
                collectors.web_servers ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <label className="text-text-secondary text-xs">웹 서버 설정</label>
                <button
                  type="button"
                  onClick={addWebServer}
                  className="text-accent hover:text-accent/80 flex items-center gap-1 text-xs"
                >
                  <Plus className="h-3 w-3" />
                  추가
                </button>
              </div>
              <div className="space-y-2">
                {webServers.map((ws, idx) => (
                  <div
                    key={idx}
                    className="border-border bg-bg-deep space-y-2 rounded-sm border p-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-text-secondary text-xs">웹 서버 #{idx + 1}</span>
                      {webServers.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeWebServer(idx)}
                          className="text-text-secondary hover:text-critical"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-text-secondary/70 mb-1 block text-xs">
                          식별자 <span className="text-text-secondary/50">(영문, name)</span>
                        </label>
                        <NeuInput
                          value={ws.name}
                          onChange={(e) => updateWebServer(idx, 'name', e.target.value)}
                          placeholder="webtob-main"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-text-secondary/70 mb-1 block text-xs">
                          표시명 <span className="text-text-secondary/50">(display_name)</span>
                        </label>
                        <NeuInput
                          value={ws.display_name}
                          onChange={(e) => updateWebServer(idx, 'display_name', e.target.value)}
                          placeholder="메인 웹서버"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-text-secondary/70 mb-1 block text-xs">
                        액세스 로그 경로 <span className="text-text-secondary/50">(log_path)</span>
                      </label>
                      <NeuInput
                        value={ws.log_path}
                        onChange={(e) => updateWebServer(idx, 'log_path', e.target.value)}
                        placeholder="/var/log/apache/access.log"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="w-32">
                        <label className="text-text-secondary/70 mb-1 block text-xs">
                          log_format
                        </label>
                        <NeuSelect
                          value={ws.log_format}
                          onChange={(e) =>
                            updateWebServer(idx, 'log_format', e.target.value as WebServerLogFormat)
                          }
                        >
                          {WEB_SERVER_LOG_FORMATS.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </NeuSelect>
                      </div>
                      <div className="w-32">
                        <label className="text-text-secondary/70 mb-1 block text-xs">slow_ms</label>
                        <NeuInput
                          type="number"
                          min={1}
                          value={ws.slow_threshold_ms}
                          onChange={(e) =>
                            updateWebServer(idx, 'slow_threshold_ms', e.target.value)
                          }
                          placeholder="3000"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-text-secondary/70 mb-1 block text-xs">
                          was_services (쉼표 구분)
                        </label>
                        <NeuInput
                          value={ws.was_services}
                          onChange={(e) => updateWebServer(idx, 'was_services', e.target.value)}
                          placeholder="jeus1, jeus2"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="bg-critical-card-bg text-critical rounded-sm px-3 py-2 text-xs">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <NeuButton type="button" variant="ghost" onClick={onClose}>
              취소
            </NeuButton>
            <NeuButton type="submit" loading={loading}>
              등록
            </NeuButton>
          </div>
        </form>
      </NeuCard>
    </div>
  )
}
