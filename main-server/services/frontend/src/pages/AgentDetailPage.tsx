import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play,
  Square,
  RotateCw,
  RefreshCw,
  Upload,
  Trash2,
  Lock,
  ArrowLeft,
  Download,
  Activity,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { AgentStatusBadge } from '@/components/agent/AgentStatusBadge'
import { SSHSessionModal } from '@/components/agent/SSHSessionModal'
import { InstallJobMonitor } from '@/components/agent/InstallJobMonitor'
import { HTTPError } from 'ky'
import { agentsApi } from '@/api/agents'
import type { AgentLiveStatus, AgentStatus } from '@/types/agent'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import { qk } from '@/constants/queryKeys'
import { ROUTES } from '@/constants/routes'
import { cn, formatKST, getAgentTypeLabel } from '@/lib/utils'

const LIVE_STATUS_CONFIG: Record<AgentLiveStatus, { label: string; color: string; dot: string }> = {
  collecting: { label: '수집 중', color: 'text-normal', dot: 'bg-normal' },
  stale: { label: '수집 중단', color: 'text-critical', dot: 'bg-critical' },
  no_data: { label: '데이터 없음', color: 'text-text-secondary', dot: 'bg-text-secondary' },
}

const CONFIG_EXAMPLE = `[agent]
system_name = "crm"
display_name = "고객관리시스템"
instance_role = "was1"   # HA 이중화 식별자 (was1/was2 등)
host = "192.168.x.x"
collect_interval_secs = 15
top_process_count = 20
log_dir = "./logs"
log_retention_days = 7

[remote_write]
endpoint = "http://<main-server>:9090/api/v1/write"
batch_size = 500
timeout_secs = 10
wal_dir = "/var/lib/synapse-agent/wal"
wal_retention_hours = 2

[collectors]
cpu = true
memory = true
disk = true
network = true
process = true
tcp_connections = true
log_monitor = true
web_servers = true
preprocessor = false
heartbeat = true

[[log_monitor]]
paths = ["/home/jeus/logs/JeusServer.log"]
keywords = ["ERROR", "CRITICAL", "PANIC", "Fatal", "Exception"]
log_type = "jeus"

[[log_monitor]]
paths = ["/opt/app/logs/*.log"]
keywords = ["ERROR", "CRITICAL", "PANIC", "Fatal", "Exception"]
log_type = "app"

[[services]]
name = "jeus-was1"
display_name = "업무서버-1"
process_match = "was1"

[[services]]
name = "jeus-was2"
display_name = "업무서버-2"
process_match = "was2"

[[web_servers]]
name = "nginx-main"
display_name = "메인 웹서버"
type = "nginx"
log_path = "/var/log/nginx/access.log"
log_format = "nginx_json"
was_services = ["jeus-was1", "jeus-was2"]
slow_threshold_ms = 2000
url_patterns = [
  { pattern = "/api/customers", display = "고객조회" },
  { pattern = "/api/orders", display = "주문처리" },
]

[[web_servers]]
name = "webtob-api"
display_name = "API 웹서버"
type = "webtob"
log_path = "/opt/webtob/logs/access.log"
log_format = "combined"
was_services = ["jeus-was3"]
slow_threshold_ms = 3000
url_patterns = []

[preprocessor]
summary_intervals_secs = [60, 300]`

function colorizeTomlLine(line: string) {
  const t = line.trim()
  if (!t) return <>{line}</>
  if (t.startsWith('#')) return <span className="text-text-disabled">{line}</span>
  if (/^\[\[.+\]\]/.test(t)) return <span className="text-accent font-medium">{line}</span>
  if (/^\[.+\]/.test(t)) return <span className="text-accent">{line}</span>
  if (t.startsWith('{') || t.startsWith(']') || t === ']')
    return <span className="text-text-primary">{line}</span>
  const eqIdx = line.indexOf('=')
  if (eqIdx === -1) return <span className="text-text-secondary">{line}</span>
  const keyPart = line.slice(0, eqIdx)
  let rest = line.slice(eqIdx + 1)
  let comment = ''
  let inStr = false
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '"') inStr = !inStr
    if (!inStr && rest[i] === '#') {
      comment = rest.slice(i)
      rest = rest.slice(0, i)
      break
    }
  }
  const val = rest.trim()
  const valClass =
    val === 'true' || val === 'false'
      ? 'text-accent'
      : /^\d+$/.test(val)
        ? 'text-warning'
        : val.startsWith('"') || val.startsWith('[') || val.startsWith('{')
          ? 'text-normal'
          : 'text-text-primary'
  return (
    <>
      <span className="text-text-secondary">{keyPart}</span>
      <span className="text-text-disabled">{'='}</span>
      <span className={valClass}>{rest}</span>
      {comment && <span className="text-text-disabled"> {comment}</span>}
    </>
  )
}

function validateToml(content: string): string | null {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[[')) {
      if (!line.includes(']]')) return `${i + 1}번째 줄: ']]' 닫는 괄호가 없습니다`
      continue
    }
    if (line.startsWith('[')) {
      if (!line.includes(']')) return `${i + 1}번째 줄: ']' 닫는 괄호가 없습니다`
      continue
    }
    if (line.startsWith('{') || line === ']' || line.startsWith(']')) continue
    if (!line.includes('=')) return `${i + 1}번째 줄: '=' 구분자가 없습니다`
    let inStr = false
    for (const ch of line.slice(line.indexOf('=') + 1)) {
      if (ch === '"') inStr = !inStr
    }
    if (inStr) return `${i + 1}번째 줄: 닫히지 않은 따옴표가 있습니다`
  }
  return null
}

const COLLECTOR_LABELS: Record<string, string> = {
  cpu: 'CPU',
  memory: '메모리',
  disk: '디스크',
  network: '네트워크',
  process: '프로세스',
  tcp_connections: 'TCP',
  log_monitor: '로그',
  web_servers: '웹 서버',
  preprocessor: '전처리기',
  heartbeat: 'Heartbeat',
}

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const agentId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { token, isValid, clearSession, refreshExpiry } = useSSHSessionStore()
  const sessionActive = isValid()

  const [showSSHModal, setShowSSHModal] = useState(false)
  const [configContent, setConfigContent] = useState<string | null>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configDirty, setConfigDirty] = useState(false)
  const [configDisplayPath, setConfigDisplayPath] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [installJobId, setInstallJobId] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState<null | 'db' | 'purge'>(null)
  const [liveProcessStatus, setLiveProcessStatus] = useState<AgentStatus | null>(null)

  const {
    data: agent,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: qk.agent(agentId),
    queryFn: () => agentsApi.getAgent(agentId),
    staleTime: 30_000,
  })

  const supportsLive = agent?.agent_type === 'synapse_agent' || agent?.agent_type === 'db'

  const { data: liveStatus } = useQuery({
    queryKey: qk.agentLiveStatus(agentId),
    queryFn: () => agentsApi.getLiveStatus(agentId),
    enabled: supportsLive,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 55_000,
  })

  const { data: allAgents } = useQuery({
    queryKey: qk.agents(),
    queryFn: () => agentsApi.getAgents(),
    staleTime: 60_000,
    enabled: agent?.agent_type !== 'db',
  })

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  function handleSSHExpired() {
    clearSession()
    setShowSSHModal(true)
    showMsg('error', 'SSH 세션이 만료되었습니다. 재등록해 주세요.')
  }

  const isDbAgent = agent?.agent_type === 'db'
  const isOtelAgent = agent?.agent_type === 'otel_javaagent'

  // synapse_agent 수집항목 (label_info.collectors 파싱)
  const labelInfo = useMemo(() => {
    try {
      return typeof agent?.label_info === 'string'
        ? (JSON.parse(agent.label_info) as Record<string, unknown>)
        : (agent?.label_info ?? {})
    } catch {
      return {}
    }
  }, [agent?.label_info])

  const configuredCollectors = (labelInfo.collectors ?? {}) as Record<string, boolean>

  const installPathConflict = useMemo(() => {
    if (!allAgents || !agent?.install_path) return null
    return (
      allAgents.find(
        (a) => a.id !== agentId && a.host === agent.host && a.install_path === agent.install_path,
      ) ?? null
    )
  }, [allAgents, agent, agentId])

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

  // OTel 전용: service_type별 inject 파일 경로 계산 (service_path + install_path 기반)
  const otelInjectInfo = (() => {
    if (!isOtelAgent || !agent) return null
    try {
      const info = JSON.parse(agent.label_info ?? '{}') as {
        service_type?: string
        service_path?: string
        tempo_service_name?: string
      }
      const installDir = agent.install_path ?? '~/otel'
      const svcType = info.service_type ?? 'standalone'
      const svcPath = info.service_path ?? ''
      let injectPath: string | null = null
      if (svcType === 'tomcat' && svcPath) injectPath = `${svcPath}/bin/setenv.sh`
      else if (svcType === 'jboss' && svcPath)
        injectPath = `${svcPath}/bin/standalone.conf.d/otel.conf`
      else if (svcType === 'jeus' && svcPath) injectPath = `${svcPath}/otel.sh`
      else if (svcType === 'systemd')
        injectPath = null // root 경로, 보통 ssh_username=root만 읽기 가능
      else injectPath = `${installDir}/otel-launch.sh`
      return { installDir, svcType, svcPath, injectPath, envPath: `${installDir}/otel-env.sh` }
    } catch {
      return null
    }
  })()

  // OTel 파일 편집기: 어떤 파일을 보고 있는지
  const [otelFileTab, setOtelFileTab] = useState<'env' | 'inject'>('env')

  const hostMismatch =
    sessionActive &&
    !isDbAgent &&
    (() => {
      const sessionHost = useSSHSessionStore.getState().host
      return !!sessionHost && agent?.host !== sessionHost
    })()

  async function runAction(action: string, fn: () => Promise<unknown>, postStatus?: AgentStatus) {
    if (!token && !isDbAgent) {
      setShowSSHModal(true)
      return
    }
    setActionLoading(action)
    try {
      await fn()
      if (postStatus !== undefined) setLiveProcessStatus(postStatus)

      if (token) refreshExpiry()
      showMsg('success', `${action} 완료`)
      await refetch()
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
      } else if (err instanceof HTTPError) {
        const body = await err.response.json().catch(() => null)
        const detail = (body as { detail?: string } | null)?.detail
        showMsg('error', detail ?? `${action} 실패`)
      } else {
        showMsg('error', `${action} 실패`)
      }
    } finally {
      setActionLoading(null)
    }
  }

  async function handleLoadConfig(otelKind?: 'env' | 'inject') {
    if (!token) {
      setShowSSHModal(true)
      return
    }
    setConfigLoading(true)
    try {
      const res =
        isOtelAgent && otelKind
          ? await agentsApi.getOtelConfig(agentId, token, otelKind)
          : await agentsApi.getConfig(agentId, token)
      refreshExpiry()
      setConfigContent(res.content)
      setConfigDisplayPath(res.config_path)
      setConfigDirty(false)
      if (isOtelAgent && otelKind) setOtelFileTab(otelKind)
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
      } else if (err instanceof HTTPError && err.response.status === 400) {
        const body = await err.response
          .json()
          .catch(() => ({ detail: '요청 오류가 발생했습니다.' }))
        showMsg('error', (body as { detail?: string }).detail ?? '요청 오류가 발생했습니다.')
      } else if (err instanceof HTTPError && err.response.status === 404) {
        const body = await err.response.json().catch(() => ({ detail: '파일을 찾을 수 없습니다.' }))
        showMsg('error', (body as { detail?: string }).detail ?? '파일을 찾을 수 없습니다.')
      } else {
        showMsg('error', '설정 파일 불러오기 실패')
      }
    } finally {
      setConfigLoading(false)
    }
  }

  async function handleUploadConfig() {
    if (!token || configContent === null) return
    const tomlError = validateToml(configContent)
    if (tomlError) {
      showMsg('error', `TOML 형식 오류 — ${tomlError}`)
      return
    }
    setActionLoading('설정 업로드')
    try {
      await agentsApi.uploadConfig(agentId, token, configContent)
      setConfigDirty(false)
      refreshExpiry()
      void refetch()
      showMsg('success', '설정 파일이 업로드되었습니다.')
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
      } else {
        showMsg('error', '설정 업로드 실패')
      }
    } finally {
      setActionLoading(null)
    }
  }

  async function handleRefreshStatus() {
    if (isDbAgent) {
      await refetch()
      return
    }
    if (!token) {
      setShowSSHModal(true)
      return
    }
    setActionLoading('상태 갱신')
    try {
      const result = await agentsApi.getStatus(agentId, token)
      setLiveProcessStatus(result.status)
      if (token) refreshExpiry()
      showMsg('success', '상태 갱신 완료')
      await refetch()
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
      } else {
        showMsg('error', '상태 갱신 실패')
      }
    } finally {
      setActionLoading(null)
    }
  }

  async function handleInstall() {
    if (!token) {
      setShowSSHModal(true)
      return
    }
    try {
      const job = await agentsApi.installAgent({ agent_id: agentId }, token)
      refreshExpiry()
      setInstallJobId(job.job_id)
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
      } else {
        showMsg('error', '설치 Job 생성 실패')
      }
    }
  }

  const handleInstallDone = useCallback(() => {
    refetch()
    qc.invalidateQueries({ queryKey: qk.agents() })
  }, [refetch, qc])

  useEffect(() => {
    if (!sessionActive || hostMismatch || isDbAgent || isOtelAgent || !agent || !token) return
    agentsApi
      .getStatus(agentId, token)
      .then((res) => setLiveProcessStatus(res.status))
      .catch((err) => {
        if (err instanceof HTTPError && err.response.status === 401) handleSSHExpired()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionActive, hostMismatch, isDbAgent, isOtelAgent, token])

  async function handleDelete() {
    try {
      await agentsApi.deleteAgent(agentId)
      await qc.invalidateQueries({ queryKey: qk.agents() })
      navigate(ROUTES.AGENTS)
    } catch {
      showMsg('error', '삭제 실패')
      setDeleteMode(null)
    }
  }

  async function handlePurge() {
    if (!token) return
    setActionLoading('완전 삭제')
    try {
      await agentsApi.purgeAgent(agentId, token)
      await qc.invalidateQueries({ queryKey: qk.agents() })
      navigate(ROUTES.AGENTS)
    } catch (err) {
      if (err instanceof HTTPError) {
        if (err.response.status === 401) {
          handleSSHExpired()
        } else {
          const body = await err.response.json().catch(() => null)
          const detail = (body as { detail?: string } | null)?.detail
          showMsg('error', detail ? `완전 삭제 실패: ${detail}` : '완전 삭제 실패')
        }
      } else {
        showMsg('error', '완전 삭제 실패')
      }
      setDeleteMode(null)
    } finally {
      setActionLoading(null)
    }
  }

  if (isLoading) return <LoadingSkeleton shape="card" count={3} />
  if (isError || !agent) return <ErrorCard onRetry={refetch} />

  const effectiveStatus: AgentStatus = liveProcessStatus ?? agent.status
  const dynamicStyling = !isOtelAgent && !isDbAgent
  const isRunning = dynamicStyling && effectiveStatus === 'running'

  return (
    <div>
      <PageHeader
        title={getAgentTypeLabel(agent.agent_type)}
        description={(() => {
          const info = (() => {
            try {
              return JSON.parse(agent.label_info ?? '{}')
            } catch {
              return {}
            }
          })()
          return [agent.host, agent.os_type, agent.server_type, info.db_type, info.instance_role]
            .filter(Boolean)
            .join(' · ')
        })()}
        action={
          <div className="flex items-center gap-2">
            <NeuButton variant="ghost" size="sm" onClick={() => navigate(ROUTES.AGENTS)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              목록
            </NeuButton>
            {!sessionActive && !isDbAgent && (
              <NeuButton variant="glass" size="sm" onClick={() => setShowSSHModal(true)}>
                <Lock className="h-3.5 w-3.5" />
                SSH 세션 등록
              </NeuButton>
            )}
          </div>
        }
      />

      {/* 메시지 토스트 */}
      {message && (
        <div
          className={`mb-4 rounded-sm px-4 py-3 text-sm ${
            message.type === 'success' ? 'text-normal bg-normal-bg' : 'text-critical bg-critical-bg'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* [1] 설치 카드 — 전체 너비, 최상단 */}
      <NeuCard className="mb-6">
        <h2 className="text-text-primary mb-4 text-sm font-semibold">설치</h2>
        <p className="text-text-secondary mb-3 text-xs">
          바이너리 다운로드 + 디렉터리 구성. SSH 세션이 등록되어 있어야 합니다.
        </p>
        {installPathConflict && (
          <div className="border-warning/40 bg-warning/10 text-warning mb-3 rounded-sm border px-3 py-2 text-xs">
            <b>설치 경로 충돌</b> — 같은 호스트의 다른 에이전트(
            {(() => {
              try {
                const info = JSON.parse(installPathConflict.label_info ?? '{}') as {
                  instance_role?: string
                }
                return info.instance_role ?? `ID ${installPathConflict.id}`
              } catch {
                return `ID ${installPathConflict.id}`
              }
            })()}
            )가 동일한 설치 경로({agent.install_path})를 사용 중입니다. 설치 시 설정 파일이
            덮어써집니다. 에이전트별로 고유한 경로를 지정해 주세요.
          </div>
        )}
        <NeuButton
          size="sm"
          variant="glass"
          onClick={handleInstall}
          disabled={!sessionActive || hostMismatch || !!installPathConflict}
        >
          <Download className="h-3.5 w-3.5" />
          설치 실행
        </NeuButton>
        {installJobId && (
          <div className="border-border mt-4 border-t pt-4">
            <p className="text-text-primary mb-2 text-xs font-medium">설치 진행 상황</p>
            <InstallJobMonitor jobId={installJobId} onDone={handleInstallDone} />
          </div>
        )}
      </NeuCard>

      {/* [2]+[3] 2열 그리드 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* [2] 상태 및 제어 */}
        <NeuCard>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-text-primary text-sm font-semibold">상태 및 제어</h2>
            <AgentStatusBadge status={liveProcessStatus ?? agent.status} />
          </div>

          <dl className="mb-6 space-y-2 text-sm">
            <InfoRow label="호스트" value={agent.host} />
            <InfoRow label="OS" value={agent.os_type ?? '-'} />
            <InfoRow label="서버 역할" value={agent.server_type ?? '-'} />
            {(() => {
              const info = (() => {
                try {
                  return JSON.parse(agent.label_info ?? '{}')
                } catch {
                  return {}
                }
              })()
              return (
                <>
                  {agent.agent_type === 'db' && info.db_type && (
                    <InfoRow label="DB 타입" value={info.db_type} />
                  )}
                  {info.instance_role && (
                    <InfoRow label="instance_role" value={info.instance_role} />
                  )}
                </>
              )
            })()}
            {agent.agent_type !== 'db' && (
              <>
                <InfoRow label="SSH 계정" value={agent.ssh_username ?? '-'} />
                <InfoRow label="설치 경로" value={agent.install_path ?? '-'} />
                <InfoRow label="PID 파일" value={agent.pid_file ?? '-'} />
              </>
            )}
          </dl>

          {/* 호스트 불일치 경고 */}
          {hostMismatch && (
            <p className="text-warning mb-3 text-xs">
              SSH 세션 호스트({useSSHSessionStore.getState().host})와 에이전트 호스트(
              {agent.host})가 다릅니다. 제어 명령을 사용하려면 해당 호스트로 SSH 세션을
              재등록하세요.
            </p>
          )}

          {/* 제어 버튼 — OTel은 별도 프로세스가 아니므로 start/stop/restart 없음 */}
          {isOtelAgent ? (
            <div className="border-accent bg-accent-muted/40 rounded-sm border p-3 text-xs">
              <p className="text-accent mb-1 font-semibold">OTel Java 수집기 활성화 제어 안내</p>
              <p className="text-text-secondary leading-relaxed">
                OTel Java Agent는 별도 프로세스가 아닌 WAS JVM 내부에 주입되는 라이브러리입니다.
                따라서 시작/중지/재시작은 <b className="text-text-primary">WAS 자체를 재시작</b>하는
                것으로 반영되며, 이 페이지의 프로세스 제어 버튼은 OTel 타입에선 제공되지 않습니다.
              </p>
              <ul className="text-text-secondary mt-2 list-inside list-disc space-y-0.5">
                <li>
                  활성화 → 설치 후 WAS 재시작 (서비스 유형별 자동 로드: setenv.sh /
                  standalone.conf.d / systemd)
                </li>
                <li>
                  비활성화 → inject 파일에서 synapse-otel 블록 제거 또는 파일 삭제 후 WAS 재시작
                </li>
                <li>설정 변경 → 아래 설정 파일 편집기에서 otel-env.sh 수정 → WAS 재시작</li>
              </ul>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <NeuButton
                size="sm"
                variant={isRunning ? 'ghost' : 'primary'}
                onClick={() =>
                  runAction(
                    '실행',
                    () => agentsApi.startAgent(agentId, token ?? undefined),
                    'running',
                  )
                }
                loading={actionLoading === '실행'}
                disabled={(!isDbAgent && !sessionActive) || hostMismatch}
              >
                <Play className="h-3.5 w-3.5" />
                실행
              </NeuButton>
              <NeuButton
                size="sm"
                variant={isRunning ? 'primary' : 'ghost'}
                onClick={() =>
                  runAction(
                    '중지',
                    () => agentsApi.stopAgent(agentId, token ?? undefined),
                    'stopped',
                  )
                }
                loading={actionLoading === '중지'}
                disabled={(!isDbAgent && !sessionActive) || hostMismatch}
              >
                <Square className="h-3.5 w-3.5" />
                중지
              </NeuButton>
              <NeuButton
                size="sm"
                variant="ghost"
                onClick={() =>
                  runAction(
                    '재시작',
                    () => agentsApi.restartAgent(agentId, token ?? undefined),
                    'running',
                  )
                }
                loading={actionLoading === '재시작'}
                disabled={(!isDbAgent && !sessionActive) || hostMismatch}
              >
                <RotateCw className="h-3.5 w-3.5" />
                재시작
              </NeuButton>
              <NeuButton
                size="sm"
                variant="ghost"
                onClick={handleRefreshStatus}
                loading={actionLoading === '상태 갱신'}
                disabled={(!isDbAgent && !sessionActive) || hostMismatch}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                상태 갱신
              </NeuButton>
            </div>
          )}

          {/* 삭제 */}
          <div className="border-border mt-4 border-t pt-4">
            {deleteMode === null ? (
              <div className="flex flex-wrap gap-2">
                <NeuButton size="sm" variant="danger" onClick={() => setDeleteMode('db')}>
                  <Trash2 className="h-3.5 w-3.5" />
                  에이전트 삭제
                </NeuButton>
                {!isDbAgent && !isOtelAgent && (
                  <NeuButton
                    size="sm"
                    variant="danger"
                    onClick={() => setDeleteMode('purge')}
                    disabled={!sessionActive}
                    title={
                      !sessionActive ? 'SSH 세션 등록 후 사용 가능' : '원격 파일 포함 완전 삭제'
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    완전 삭제 (원격 포함)
                  </NeuButton>
                )}
              </div>
            ) : deleteMode === 'db' ? (
              <div className="space-y-2">
                <p className="text-critical text-xs">
                  DB에서만 삭제됩니다. 원격 파일은 유지됩니다.
                </p>
                <div className="flex gap-2">
                  <NeuButton size="sm" variant="danger" onClick={handleDelete}>
                    삭제 확인
                  </NeuButton>
                  <NeuButton size="sm" variant="ghost" onClick={() => setDeleteMode(null)}>
                    취소
                  </NeuButton>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-critical text-xs font-medium">
                  프로세스 종료 + 설치 디렉터리 삭제 + DB 삭제가 모두 실행됩니다.
                </p>
                <div className="flex gap-2">
                  <NeuButton
                    size="sm"
                    variant="danger"
                    onClick={handlePurge}
                    loading={actionLoading === '완전 삭제'}
                  >
                    완전 삭제 확인
                  </NeuButton>
                  <NeuButton size="sm" variant="ghost" onClick={() => setDeleteMode(null)}>
                    취소
                  </NeuButton>
                </div>
              </div>
            )}
          </div>
        </NeuCard>

        {/* [3] synapse/db → 수집 상태 | otel → 설정 파일 */}
        {supportsLive ? (
          /* 수집 상태 (Prometheus 기반 — synapse_agent / db) */
          <NeuCard>
            <div className="mb-4 flex items-center gap-2">
              <Activity className="text-accent h-4 w-4" />
              <h2 className="text-text-primary text-sm font-semibold">
                수집 상태 (Prometheus · 최근 1분)
              </h2>
              {liveStatus?.live_status && (
                <span className="ml-auto flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${LIVE_STATUS_CONFIG[liveStatus.live_status].dot}`}
                  />
                  <span
                    className={`text-xs font-medium ${LIVE_STATUS_CONFIG[liveStatus.live_status].color}`}
                  >
                    {LIVE_STATUS_CONFIG[liveStatus.live_status].label}
                  </span>
                </span>
              )}
            </div>
            {liveStatus ? (
              <div className="space-y-3">
                {liveStatus.last_seen && (
                  <p className="text-text-secondary text-xs">
                    마지막 수신:{' '}
                    <span className="text-text-primary">
                      {formatKST(liveStatus.last_seen, 'datetime')}
                    </span>
                  </p>
                )}
                {liveStatus.collectors_active && liveStatus.collectors_active.length > 0 && (
                  <div>
                    <p className="text-text-secondary mb-2 text-xs">활성 수집기</p>
                    <div className="flex flex-wrap gap-1.5">
                      {liveStatus.collectors_active.map((c) => (
                        <span
                          key={c}
                          className="text-normal bg-normal-bg rounded-full px-2.5 py-0.5 text-xs font-medium"
                        >
                          {COLLECTOR_LABELS[c] ?? c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(!liveStatus.collectors_active || liveStatus.collectors_active.length === 0) && (
                  <p className="text-text-secondary text-xs">활성 수집기 정보 없음</p>
                )}
                {agent.agent_type === 'synapse_agent' && (
                  <div className="border-border mt-4 border-t pt-3">
                    <p className="text-text-secondary mb-2 text-xs font-semibold">수집항목 설정</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                      {COLLECTOR_KEYS.map((key) => {
                        const isConfigured = !!configuredCollectors[key]
                        const isActive = (liveStatus.collectors_active ?? []).includes(key)
                        return (
                          <label
                            key={key}
                            className={cn(
                              'flex items-center gap-2 transition-opacity',
                              isConfigured ? 'opacity-100' : 'opacity-40',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={isConfigured}
                              disabled
                              className="accent-accent rounded-sm"
                            />
                            <span className="text-text-primary text-xs">
                              {COLLECTOR_LABELS[key] ?? key}
                            </span>
                            {isActive && (
                              <span
                                className="bg-normal h-1.5 w-1.5 rounded-full"
                                aria-label="수집 중"
                                title="Prometheus에서 실시간 수신 중"
                              />
                            )}
                          </label>
                        )
                      })}
                    </div>
                    <p className="text-text-disabled mt-2 text-[10px]">
                      체크된 항목 = DB 등록 설정 / 초록 점 = Prometheus 실시간 수집 중
                      <br />
                      설정 파일 직접 수정 시 체크 상태와 불일치할 수 있음
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-text-secondary text-xs">Prometheus에서 상태를 조회 중입니다...</p>
            )}
          </NeuCard>
        ) : (
          /* OTel: 설정 파일을 우측 열에 배치 */
          <NeuCard>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-text-primary text-sm font-semibold">설정 파일</h2>
              <span className="text-text-secondary font-mono text-xs">
                {configDisplayPath ?? agent.config_path}
              </span>
            </div>
            {isOtelAgent && otelInjectInfo && (
              <div className="mb-3 flex items-center gap-2">
                <div
                  className="bg-bg-base shadow-neu-pressed inline-flex gap-1 rounded-sm p-1"
                  role="group"
                  aria-label="OTel 설정 파일 선택"
                >
                  <button
                    type="button"
                    aria-pressed={otelFileTab === 'env'}
                    onClick={() => handleLoadConfig('env')}
                    disabled={!sessionActive || configLoading}
                    className={cn(
                      'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
                      otelFileTab === 'env'
                        ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                        : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
                    )}
                  >
                    otel-env.sh (공통 환경변수)
                  </button>
                  <button
                    type="button"
                    aria-pressed={otelFileTab === 'inject'}
                    onClick={() => handleLoadConfig('inject')}
                    disabled={!sessionActive || configLoading || otelInjectInfo.injectPath === null}
                    title={
                      otelInjectInfo.injectPath === null
                        ? 'systemd는 root 권한이 필요해 읽기 불가'
                        : `${otelInjectInfo.svcType} inject 파일`
                    }
                    className={cn(
                      'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
                      otelFileTab === 'inject'
                        ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                        : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
                      otelInjectInfo.injectPath === null && 'opacity-50',
                    )}
                  >
                    {otelInjectInfo.svcType} inject 파일
                  </button>
                </div>
                <span className="text-text-disabled text-[10px]">
                  읽기 전용 · 수정은 재설치로 적용
                </span>
              </div>
            )}
            {configContent === null ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <p className="text-text-secondary text-sm">
                  설정 파일을 불러오려면 아래 버튼을 누르세요.
                </p>
                <NeuButton
                  size="sm"
                  variant="glass"
                  onClick={() => handleLoadConfig(isOtelAgent ? 'env' : undefined)}
                  loading={configLoading}
                  disabled={!sessionActive}
                >
                  설정 파일 불러오기
                </NeuButton>
              </div>
            ) : (
              <div className="space-y-3">
                <NeuTextarea
                  value={configContent}
                  onChange={(e) => {
                    if (isOtelAgent) return
                    setConfigContent(e.target.value)
                    setConfigDirty(true)
                  }}
                  readOnly={isOtelAgent}
                  rows={20}
                  className={cn('font-mono text-xs', isOtelAgent && 'bg-bg-deep/50 cursor-default')}
                />
                <div className="flex items-center justify-between">
                  <NeuButton
                    size="sm"
                    variant="ghost"
                    onClick={() => handleLoadConfig(isOtelAgent ? otelFileTab : undefined)}
                    loading={configLoading}
                    disabled={!sessionActive}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    다시 불러오기
                  </NeuButton>
                  {!isOtelAgent && (
                    <NeuButton
                      size="sm"
                      onClick={handleUploadConfig}
                      loading={actionLoading === '설정 업로드'}
                      disabled={!sessionActive || !configDirty}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      업로드 및 Reload
                    </NeuButton>
                  )}
                </div>
                {configDirty && !isOtelAgent && (
                  <p className="text-warning text-xs">저장되지 않은 변경사항이 있습니다.</p>
                )}
                {isOtelAgent && (
                  <p className="text-text-disabled text-xs">
                    ※ OTel 설정은 재설치로만 갱신됩니다. 변경이 필요하면 에이전트 등록 정보를 수정한
                    뒤 &lsquo;설치 실행&rsquo;을 다시 누르세요.
                  </p>
                )}
              </div>
            )}
          </NeuCard>
        )}
      </div>

      {/* [4] synapse_agent 전용 설정 파일 — 전체 너비, 2컬럼 */}
      {supportsLive && !isDbAgent && (
        <NeuCard className="mt-6">
          <h2 className="text-text-primary mb-4 text-sm font-semibold">설정 파일</h2>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* 왼쪽: 샘플 설정 */}
            <div className="flex flex-col">
              <p className="text-text-disabled mb-3 text-xs font-medium">
                샘플 (config.example.toml)
              </p>
              <div className="bg-bg-deep h-[480px] overflow-auto rounded-sm p-3">
                <pre className="font-mono text-xs leading-relaxed">
                  {CONFIG_EXAMPLE.split('\n').map((line, i) => (
                    <span key={i} className="block">
                      {colorizeTomlLine(line)}
                    </span>
                  ))}
                </pre>
              </div>
            </div>

            {/* 오른쪽: 실제 설정 로드 및 편집 */}
            <div className="flex flex-col">
              {configContent === null ? (
                <div className="flex h-[480px] flex-col items-center justify-center gap-3">
                  <p className="text-text-secondary text-center text-sm">
                    왼쪽 샘플을 참고하여
                    <br />
                    서버의 설정 파일을 불러오세요.
                  </p>
                  <NeuButton
                    size="sm"
                    variant="glass"
                    onClick={() => handleLoadConfig(undefined)}
                    loading={configLoading}
                    disabled={!sessionActive}
                  >
                    설정 파일 불러오기
                  </NeuButton>
                  {!sessionActive && (
                    <p className="text-text-disabled text-xs">SSH 세션 등록 후 사용 가능</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-text-secondary font-mono text-xs">
                    {configDisplayPath ?? agent.config_path}
                  </p>
                  <TomlEditor
                    value={configContent}
                    onChange={(v) => {
                      setConfigContent(v)
                      setConfigDirty(true)
                    }}
                    dirty={configDirty}
                    className="h-[480px]"
                  />
                  <div className="flex items-center justify-between">
                    <NeuButton
                      size="sm"
                      variant="ghost"
                      onClick={() => handleLoadConfig(undefined)}
                      loading={configLoading}
                      disabled={!sessionActive}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      다시 불러오기
                    </NeuButton>
                    <NeuButton
                      size="sm"
                      onClick={handleUploadConfig}
                      loading={actionLoading === '설정 업로드'}
                      disabled={!sessionActive || !configDirty}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      업로드
                    </NeuButton>
                  </div>
                  {configDirty && (
                    <p className="text-warning text-xs">저장되지 않은 변경사항이 있습니다.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </NeuCard>
      )}

      {showSSHModal && (
        <SSHSessionModal
          defaultHost={agent.host}
          requiredUsername={agent.ssh_username ?? undefined}
          onSuccess={() => setShowSSHModal(false)}
          onClose={() => setShowSSHModal(false)}
        />
      )}
    </div>
  )
}

function TomlEditor({
  value,
  onChange,
  dirty = false,
  className,
}: {
  value: string
  onChange: (v: string) => void
  dirty?: boolean
  className?: string
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const syncScroll = useCallback(() => {
    if (overlayRef.current && taRef.current) {
      overlayRef.current.scrollTop = taRef.current.scrollTop
      overlayRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }, [])

  const sharedFont = 'font-mono text-xs leading-relaxed px-4 py-2.5'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-sm',
        'shadow-neu-inset border',
        'focus-within:ring-accent focus-within:ring-offset-bg-base focus-within:ring-1 focus-within:ring-offset-2',
        dirty ? 'border-warning/60' : 'border-border',
        className,
      )}
    >
      {/* 편집 가능 배지 */}
      <span className="text-accent border-accent/30 pointer-events-none absolute top-2 right-2 z-10 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium">
        편집
      </span>
      {/* 구문 강조 오버레이 (읽기 전용, 포인터 이벤트 없음) */}
      <div
        ref={overlayRef}
        aria-hidden
        className={cn(
          'bg-bg-base pointer-events-none absolute inset-0 overflow-hidden',
          sharedFont,
        )}
      >
        {value.split('\n').map((line, i) => (
          <div key={i}>{line === '' ? '​' : colorizeTomlLine(line)}</div>
        ))}
      </div>
      {/* 투명 textarea — 입력만 처리 */}
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        className={cn(
          'relative h-full w-full resize-none bg-transparent',
          'caret-text-primary text-transparent',
          'focus:outline-none',
          sharedFont,
        )}
      />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="text-text-secondary w-24 shrink-0">{label}</dt>
      <dd className="text-text-primary break-all">{value}</dd>
    </div>
  )
}
