import { useState, useCallback } from 'react'
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
import { formatKST, getAgentTypeLabel } from '@/lib/utils'

const LIVE_STATUS_CONFIG: Record<AgentLiveStatus, { label: string; color: string; dot: string }> = {
  collecting: { label: '수집 중', color: 'text-normal', dot: 'bg-normal' },
  delayed: { label: '데이터 지연', color: 'text-warning', dot: 'bg-warning' },
  stale: { label: '수집 중단', color: 'text-critical', dot: 'bg-critical' },
  no_data: { label: '데이터 없음', color: 'text-text-secondary', dot: 'bg-text-secondary' },
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
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [installJobId, setInstallJobId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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
    staleTime: 55_000,
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

  const hostMismatch =
    sessionActive &&
    !isDbAgent &&
    (() => {
      const sessionHost = useSSHSessionStore.getState().host
      return !!sessionHost && agent?.host !== sessionHost
    })()

  async function runAction(action: string, fn: () => Promise<unknown>) {
    if (!token && !isDbAgent) {
      setShowSSHModal(true)
      return
    }
    setActionLoading(action)
    try {
      await fn()
      if (token) refreshExpiry()
      showMsg('success', `${action} 완료`)
      await refetch()
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
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
      setConfigDirty(false)
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 401) {
        handleSSHExpired()
      } else {
        showMsg('error', '설정 파일 불러오기 실패')
      }
    } finally {
      setConfigLoading(false)
    }
  }

  async function handleUploadConfig() {
    if (!token || configContent === null) return
    await runAction('설정 업로드', () => agentsApi.uploadConfig(agentId, token, configContent))
    setConfigDirty(false)
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

  async function handleDelete() {
    try {
      await agentsApi.deleteAgent(agentId)
      await qc.invalidateQueries({ queryKey: qk.agents() })
      navigate(ROUTES.AGENTS)
    } catch {
      showMsg('error', '삭제 실패')
      setShowDeleteConfirm(false)
    }
  }

  if (isLoading) return <LoadingSkeleton shape="card" count={3} />
  if (isError || !agent) return <ErrorCard onRetry={refetch} />

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
            message.type === 'success'
              ? 'text-normal bg-[rgba(34,197,94,0.08)]'
              : 'text-critical bg-[rgba(239,68,68,0.08)]'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 상태 + 제어 */}
        <NeuCard>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-text-primary text-sm font-semibold">상태 및 제어</h2>
            {(() => {
              const headerStatus: AgentStatus = liveStatus
                ? liveStatus.live
                  ? 'running'
                  : 'stopped'
                : agent.status
              return <AgentStatusBadge status={headerStatus} />
            })()}
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
            <InfoRow label="포트" value={agent.port ? String(agent.port) : '-'} />
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

          {/* 제어 버튼 */}
          <div className="flex flex-wrap gap-2">
            <NeuButton
              size="sm"
              onClick={() =>
                runAction('실행', () => agentsApi.startAgent(agentId, token ?? undefined))
              }
              loading={actionLoading === '실행'}
              disabled={(!isDbAgent && !sessionActive) || hostMismatch}
            >
              <Play className="h-3.5 w-3.5" />
              실행
            </NeuButton>
            <NeuButton
              size="sm"
              variant="ghost"
              onClick={() =>
                runAction('중지', () => agentsApi.stopAgent(agentId, token ?? undefined))
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
                runAction('재시작', () => agentsApi.restartAgent(agentId, token ?? undefined))
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
              onClick={() =>
                isDbAgent
                  ? refetch()
                  : runAction('상태 확인', () => agentsApi.getStatus(agentId, token ?? undefined))
              }
              loading={actionLoading === '상태 확인'}
              disabled={(!isDbAgent && !sessionActive) || hostMismatch}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              상태 갱신
            </NeuButton>
          </div>

          {/* 설치 */}
          <div className="border-border mt-4 border-t pt-4">
            <p className="text-text-secondary mb-2 text-xs">
              설치 (바이너리 다운로드 + 디렉터리 구성)
            </p>
            <NeuButton size="sm" variant="glass" onClick={handleInstall} disabled={!sessionActive || hostMismatch}>
              <Download className="h-3.5 w-3.5" />
              설치 실행
            </NeuButton>
          </div>

          {installJobId && (
            <div className="border-border mt-4 border-t pt-4">
              <p className="text-text-primary mb-2 text-xs font-medium">설치 진행 상황</p>
              <InstallJobMonitor jobId={installJobId} onDone={handleInstallDone} />
            </div>
          )}

          {/* 삭제 */}
          <div className="border-border mt-4 border-t pt-4">
            {!showDeleteConfirm ? (
              <NeuButton size="sm" variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                에이전트 삭제
              </NeuButton>
            ) : (
              <div className="space-y-2">
                <p className="text-critical text-xs">정말 삭제하시겠습니까?</p>
                <div className="flex gap-2">
                  <NeuButton size="sm" variant="danger" onClick={handleDelete}>
                    삭제 확인
                  </NeuButton>
                  <NeuButton size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(false)}>
                    취소
                  </NeuButton>
                </div>
              </div>
            )}
          </div>
        </NeuCard>

        {/* 설정 파일 편집기 */}
        {
          <NeuCard>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-text-primary text-sm font-semibold">설정 파일</h2>
              <span className="text-text-secondary text-xs">{agent.config_path}</span>
            </div>

            {configContent === null ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <p className="text-text-secondary text-sm">
                  설정 파일을 불러오려면 아래 버튼을 누르세요.
                </p>
                <NeuButton
                  size="sm"
                  variant="glass"
                  onClick={handleLoadConfig}
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
                    onClick={handleLoadConfig}
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
        }
      </div>

      {/* 수집 상태 (Prometheus 기반 — synapse_agent / db) */}
      {supportsLive && (
        <NeuCard className="mt-6">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="text-accent h-4 w-4" />
            <h2 className="text-text-primary text-sm font-semibold">
              수집 상태 (Prometheus · 최근 10분)
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
                        className="text-normal rounded-full bg-[rgba(34,197,94,0.1)] px-2.5 py-0.5 text-xs font-medium"
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
            </div>
          ) : (
            <p className="text-text-secondary text-xs">Prometheus에서 상태를 조회 중입니다...</p>
          )}
        </NeuCard>
      )}

      {showSSHModal && (
        <SSHSessionModal
          defaultHost={agent.host}
          defaultUsername={agent.ssh_username ?? ''}
          onSuccess={() => setShowSSHModal(false)}
          onClose={() => setShowSSHModal(false)}
        />
      )}
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
