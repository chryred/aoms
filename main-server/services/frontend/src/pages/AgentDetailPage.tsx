import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTabTitle } from '@/components/layout/tabs/TabContext'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
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
  Pause,
  FileText,
  ClipboardCheck,
  Check,
  AlertTriangle,
  X,
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
import { apmApi } from '@/api/apm'
import { useSystems } from '@/hooks/queries/useSystems'
import type { AgentLiveStatus, AgentPrecheckResult, AgentStatus, PrecheckStatus } from '@/types/agent'
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

const PRECHECK_STYLE: Record<PrecheckStatus, { color: string; Icon: typeof Check; label: string }> = {
  ok: { color: 'text-normal', Icon: Check, label: '통과' },
  warn: { color: 'text-warning', Icon: AlertTriangle, label: '주의' },
  fail: { color: 'text-critical', Icon: X, label: '실패' },
}

function PrecheckChecklist({ result }: { result: AgentPrecheckResult }) {
  const o = PRECHECK_STYLE[result.overall]
  const summary =
    result.overall === 'fail'
      ? '설치가 실패할 수 있습니다'
      : result.overall === 'warn'
        ? '설치 가능, 확인 필요 항목이 있습니다'
        : '설치 가능'
  return (
    <div className="border-border mt-4 border-t pt-4" data-testid="precheck-result">
      <p className={cn('mb-2 text-xs font-medium', o.color)}>
        사전 점검: {summary}
        <span className="text-text-secondary ml-2 font-normal">{formatKST(result.checked_at)} KST</span>
      </p>
      <ul className="space-y-1">
        {result.checks.map((c, i) => {
          const s = PRECHECK_STYLE[c.status]
          return (
            <li key={`${c.item}-${i}`} className="flex items-start gap-2 text-xs">
              <s.Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', s.color)} aria-label={s.label} />
              <span className="text-text-primary w-24 shrink-0 font-medium">{c.item}</span>
              <span className={c.status === 'ok' ? 'text-text-secondary' : s.color}>{c.detail}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
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
  const [showInstallConfirm, setShowInstallConfirm] = useState(false)
  const { data: systems } = useSystems()

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

  useTabTitle(agent?.host ? `에이전트 ${agent.host}` : null)

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
  const isAgentT = agent?.agent_type === 'agent_t'
  const [precheck, setPrecheck] = useState<AgentPrecheckResult | null>(null)
  const [precheckLoading, setPrecheckLoading] = useState(false)
  const [precheckError, setPrecheckError] = useState<string | null>(null)

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

  const agentTEnabled = labelInfo.enabled !== false
  const isProdSystem = systems?.find((x) => x.id === agent?.system_id)?.environment === 'prod'

  // 계측 중지/재개 — label_info.enabled 만 병합 갱신 (다른 키 유지). SSH·재기동 불필요
  async function handleToggleEnabled(enabled: boolean) {
    setActionLoading(enabled ? '계측 재개' : '계측 중지')
    try {
      await agentsApi.updateAgent(agentId, {
        label_info: JSON.stringify({ ...labelInfo, enabled }),
      })
      await qc.invalidateQueries({ queryKey: qk.agent(agentId) })
      showMsg('success', enabled ? '계측을 재개합니다.' : '계측을 중지합니다.')
    } catch {
      showMsg('error', enabled ? '계측 재개 실패' : '계측 중지 실패')
    } finally {
      setActionLoading(null)
    }
  }

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

  async function handleLoadConfig() {
    if (!token) {
      setShowSSHModal(true)
      return
    }
    setConfigLoading(true)
    try {
      const res = await agentsApi.getConfig(agentId, token)
      refreshExpiry()
      setConfigContent(res.content)
      setConfigDisplayPath(res.config_path)
      setConfigDirty(false)
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

  async function handlePrecheck() {
    if (!token) {
      setShowSSHModal(true)
      return
    }
    setPrecheckLoading(true)
    setPrecheckError(null)
    try {
      const res = await agentsApi.precheckAgent(agentId, token)
      refreshExpiry()
      setPrecheck(res)
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
      } else {
        setPrecheckError('사전 점검을 실행하지 못했습니다.')
      }
    } finally {
      setPrecheckLoading(false)
    }
  }

  async function handleInstall(targetPid?: number) {
    if (!token) {
      setShowSSHModal(true)
      return
    }
    try {
      const job = await agentsApi.installAgent(
        targetPid ? { agent_id: agentId, target_pid: targetPid } : { agent_id: agentId },
        token,
      )
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
    if (!sessionActive || hostMismatch || isDbAgent || isAgentT || !agent || !token) return
    agentsApi
      .getStatus(agentId, token)
      .then((res) => setLiveProcessStatus(res.status))
      .catch((err) => {
        if (err instanceof HTTPError && err.response.status === 401) handleSSHExpired()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, sessionActive, hostMismatch, isDbAgent, isAgentT, token])

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
  const dynamicStyling = !isAgentT && !isDbAgent
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
          onClick={() => (isAgentT ? setShowInstallConfirm(true) : handleInstall())}
          disabled={!sessionActive || hostMismatch || !!installPathConflict}
        >
          <Download className="h-3.5 w-3.5" />
          설치 실행
        </NeuButton>
        {isAgentT && (
          <>
            <NeuButton
              size="sm"
              variant="glass"
              className="ml-2"
              onClick={handlePrecheck}
              disabled={!sessionActive || hostMismatch || !!installPathConflict || precheckLoading}
              title={!sessionActive ? 'SSH 세션 등록 후 사용 가능' : '서버를 변경하지 않고 설치 가능 여부만 점검'}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              {precheckLoading ? '점검 중...' : '사전 점검'}
            </NeuButton>
            {!sessionActive && (
              <span className="text-text-secondary ml-2 text-xs">SSH 세션 등록 후 사용 가능</span>
            )}
            {precheckError && <p className="text-critical mt-3 text-xs">{precheckError}</p>}
            {precheck && <PrecheckChecklist result={precheck} />}
          </>
        )}
        {installJobId && (
          <div className="border-border mt-4 border-t pt-4">
            <p className="text-text-primary mb-2 text-xs font-medium">설치 진행 상황</p>
            <InstallJobMonitor
              key={installJobId}
              jobId={installJobId}
              onDone={handleInstallDone}
              onSelectTarget={isAgentT ? (pid) => handleInstall(pid) : undefined}
            />
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
                  {agent.agent_type === 'agent_t' && (
                    <InfoRow
                      label="요청 파라미터 수집"
                      value={info.capture_params ? '사용' : '사용 안 함'}
                    />
                  )}
                  {agent.agent_type === 'agent_t' &&
                    info.capture_params &&
                    info.capture_params_include && (
                      <InfoRow label="포함 URI" value={info.capture_params_include} />
                    )}
                  {agent.agent_type === 'agent_t' &&
                    info.capture_params &&
                    info.capture_params_exclude && (
                      <InfoRow label="제외 URI" value={info.capture_params_exclude} />
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

          {/* 제어 버튼 — Agent-T 는 별도 프로세스가 아니므로 계측 중지/재개만 제공 */}
          {isAgentT ? (
            <div className="border-border rounded-sm border p-3 text-xs">
              <p className="text-text-primary mb-2 font-semibold">
                계측 상태: {agentTEnabled ? '동작 중' : '중지됨'}
              </p>
              <p className="text-text-secondary mb-3 leading-relaxed">
                WAS 재기동 없이 계측을 끄고 켭니다. 중지하면 transformer 가 제거되고 원본 클래스가
                복원됩니다.
              </p>
              <div className="flex gap-2">
                <NeuButton
                  size="sm"
                  variant="danger"
                  onClick={() => handleToggleEnabled(false)}
                  loading={actionLoading === '계측 중지'}
                  disabled={!agentTEnabled}
                >
                  <Pause className="h-3.5 w-3.5" />
                  계측 중지
                </NeuButton>
                <NeuButton
                  size="sm"
                  variant="primary"
                  onClick={() => handleToggleEnabled(true)}
                  loading={actionLoading === '계측 재개'}
                  disabled={agentTEnabled}
                >
                  <Play className="h-3.5 w-3.5" />
                  계측 재개
                </NeuButton>
              </div>
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
                {!isDbAgent && !isAgentT && (
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

        {/* [3] synapse/db → 수집 상태 | agent_t → 스레드 덤프 | 그 외 → 설정 파일 */}
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
        ) : isAgentT ? (
          <ThreadDumpCard agentId={agentId} />
        ) : (
          <NeuCard>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-text-primary text-sm font-semibold">설정 파일</h2>
              <span className="text-text-secondary font-mono text-xs">
                {configDisplayPath ?? agent.config_path}
              </span>
            </div>
            {configContent === null ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <p className="text-text-secondary text-sm">
                  설정 파일을 불러오려면 아래 버튼을 누르세요.
                </p>
                <NeuButton
                  size="sm"
                  variant="glass"
                  onClick={() => handleLoadConfig()}
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
                    setConfigContent(e.target.value)
                    setConfigDirty(true)
                  }}
                  rows={20}
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-between">
                  <NeuButton
                    size="sm"
                    variant="ghost"
                    onClick={() => handleLoadConfig()}
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
                    업로드 및 Reload
                  </NeuButton>
                </div>
                {configDirty && (
                  <p className="text-warning text-xs">저장되지 않은 변경사항이 있습니다.</p>
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
                    onClick={() => handleLoadConfig()}
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
                      onClick={() => handleLoadConfig()}
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

      {showInstallConfirm && (
        <AgentTInstallConfirm
          prod={isProdSystem}
          onCancel={() => setShowInstallConfirm(false)}
          onConfirm={() => {
            setShowInstallConfirm(false)
            handleInstall()
          }}
        />
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

function AgentTInstallConfirm({
  prod,
  onConfirm,
  onCancel,
}: {
  prod: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-overlay absolute inset-0" aria-hidden="true" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="에이전트 적용 확인"
        className={cn(
          'bg-bg-base shadow-neu-flat relative z-10 mx-4 w-full max-w-md rounded-sm p-6',
          prod && 'border-critical border',
        )}
      >
        {prod && (
          <p className="bg-critical-bg text-critical-text mb-3 rounded-sm px-3 py-2 text-xs font-semibold">
            운영 시스템입니다. 아래 안내를 확인한 뒤 진행하세요.
          </p>
        )}
        <h3 className="text-text-primary text-base font-semibold">에이전트를 적용합니다.</h3>
        <ul className="text-text-secondary mt-3 list-inside list-disc space-y-1.5 text-sm leading-relaxed">
          <li>
            <strong className="text-text-primary">즉시 적용</strong>: 실행 중인 WAS 에 바로
            붙습니다. 적용 직후 수 초간 CPU 사용률이 일시적으로 오를 수 있습니다.
          </li>
          <li>
            <strong className="text-text-primary">영구 적용</strong>: WAS 기동 설정(
            <code>domain.xml</code> 등)에 등록됩니다.{' '}
            <strong className="text-text-primary">
              다음 WAS 재기동부터 기동 옵션으로 적용되며, 재기동은 운영 일정에 맞춰 별도로 진행해
              주세요.
            </strong>
          </li>
          <li>적용을 끄려면 에이전트 화면의 &quot;계측 중지&quot;를 누르세요(재기동 불필요).</li>
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <NeuButton variant="ghost" size="sm" onClick={onCancel}>
            취소
          </NeuButton>
          <NeuButton variant={prod ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>
            적용
          </NeuButton>
        </div>
      </div>
    </div>
  )
}

function ThreadDumpCard({ agentId }: { agentId: number }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<number | null>(null)
  const [requesting, setRequesting] = useState(false)

  const { data: dumps = [] } = useQuery({
    queryKey: qk.apm.threadDumps(agentId),
    queryFn: () => apmApi.listThreadDumps(agentId),
    refetchInterval: 5_000,
  })
  const { data: dump } = useQuery({
    queryKey: qk.apm.threadDump(agentId, selected ?? 0),
    queryFn: () => apmApi.getThreadDump(agentId, selected!),
    enabled: selected != null,
  })

  async function request() {
    setRequesting(true)
    try {
      await apmApi.requestThreadDump(agentId)
      toast.success('스레드 덤프를 요청했습니다')
      await qc.invalidateQueries({ queryKey: qk.apm.threadDumps(agentId) })
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 409)
        toast('진행 중인 스레드 덤프 요청이 있습니다')
      else toast.error('스레드 덤프 요청 중 오류가 발생했습니다')
    } finally {
      setRequesting(false)
    }
  }

  return (
    <NeuCard>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-text-primary text-sm font-semibold">스레드 덤프</h2>
        <NeuButton size="sm" variant="glass" onClick={request} loading={requesting}>
          <FileText className="h-3.5 w-3.5" />
          스레드 덤프 요청
        </NeuButton>
      </div>
      {dumps.length === 0 ? (
        <p className="text-text-secondary text-xs">요청 이력이 없습니다.</p>
      ) : (
        <ul className="divide-border divide-y text-xs">
          {dumps.map((d) => (
            <li key={d.command_id}>
              <button
                type="button"
                onClick={() => setSelected(d.command_id)}
                aria-pressed={selected === d.command_id}
                className={cn(
                  'hover:bg-hover-subtle focus:ring-accent flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left focus:ring-1 focus:outline-none',
                  selected === d.command_id && 'bg-accent-muted',
                )}
              >
                <span className="text-text-primary tabular-nums">
                  {formatKST(d.requested_at, 'datetime')}
                </span>
                <span className="text-text-secondary">
                  {d.status}
                  {d.truncated ? ' · 잘림' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected != null && dump && (
        <div className="mt-4">
          {dump.truncated && (
            <p className="text-warning mb-1 text-xs">크기 제한으로 일부가 잘렸습니다.</p>
          )}
          <pre className="bg-bg-deep max-h-[480px] overflow-auto rounded-sm p-3 font-mono text-xs leading-relaxed">
            {dump.text}
          </pre>
        </div>
      )}
    </NeuCard>
  )
}
