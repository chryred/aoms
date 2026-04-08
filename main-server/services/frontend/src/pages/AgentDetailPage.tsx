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
import { agentsApi } from '@/api/agents'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import { qk } from '@/constants/queryKeys'
import { ROUTES } from '@/constants/routes'

const AGENT_TYPE_LABEL: Record<string, string> = {
  alloy: 'Alloy',
  node_exporter: 'Node Exporter',
  jmx_exporter: 'JMX Exporter',
}

export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const agentId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { token, isValid } = useSSHSessionStore()
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

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  async function runAction(action: string, fn: () => Promise<unknown>) {
    if (!token) { setShowSSHModal(true); return }
    setActionLoading(action)
    try {
      await fn()
      showMsg('success', `${action} 완료`)
      await refetch()
    } catch {
      showMsg('error', `${action} 실패`)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleLoadConfig() {
    if (!token) { setShowSSHModal(true); return }
    setConfigLoading(true)
    try {
      const res = await agentsApi.getConfig(agentId, token)
      setConfigContent(res.content)
      setConfigDirty(false)
    } catch {
      showMsg('error', '설정 파일 불러오기 실패')
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
    if (!token) { setShowSSHModal(true); return }
    try {
      const job = await agentsApi.installAgent({ agent_id: agentId }, token)
      setInstallJobId(job.job_id)
    } catch {
      showMsg('error', '설치 Job 생성 실패')
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
        title={`${AGENT_TYPE_LABEL[agent.agent_type] ?? agent.agent_type}`}
        description={`${agent.host} · ${agent.ssh_username}`}
        action={
          <div className="flex items-center gap-2">
            <NeuButton variant="ghost" size="sm" onClick={() => navigate(ROUTES.AGENTS)}>
              <ArrowLeft className="h-3.5 w-3.5" />
              목록
            </NeuButton>
            {!sessionActive && (
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
              ? 'bg-[rgba(34,197,94,0.08)] text-[#22C55E]'
              : 'bg-[rgba(239,68,68,0.08)] text-[#EF4444]'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 상태 + 제어 */}
        <NeuCard>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#E2E8F2]">상태 및 제어</h2>
            <AgentStatusBadge status={agent.status} />
          </div>

          <dl className="mb-6 space-y-2 text-sm">
            <InfoRow label="호스트" value={agent.host} />
            <InfoRow label="계정" value={agent.ssh_username} />
            <InfoRow label="설치 경로" value={agent.install_path} />
            <InfoRow label="포트" value={agent.port ? String(agent.port) : '-'} />
            <InfoRow label="PID 파일" value={agent.pid_file ?? '-'} />
          </dl>

          {/* 제어 버튼 */}
          <div className="flex flex-wrap gap-2">
            <NeuButton
              size="sm"
              onClick={() => runAction('실행', () => agentsApi.startAgent(agentId, token!))}
              loading={actionLoading === '실행'}
              disabled={!sessionActive}
            >
              <Play className="h-3.5 w-3.5" />
              실행
            </NeuButton>
            <NeuButton
              size="sm"
              variant="ghost"
              onClick={() => runAction('중지', () => agentsApi.stopAgent(agentId, token!))}
              loading={actionLoading === '중지'}
              disabled={!sessionActive}
            >
              <Square className="h-3.5 w-3.5" />
              중지
            </NeuButton>
            <NeuButton
              size="sm"
              variant="ghost"
              onClick={() => runAction('재시작', () => agentsApi.restartAgent(agentId, token!))}
              loading={actionLoading === '재시작'}
              disabled={!sessionActive}
            >
              <RotateCw className="h-3.5 w-3.5" />
              재시작
            </NeuButton>
            <NeuButton
              size="sm"
              variant="ghost"
              onClick={() => runAction('상태 확인', () => agentsApi.getStatus(agentId, token!))}
              loading={actionLoading === '상태 확인'}
              disabled={!sessionActive}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              상태 갱신
            </NeuButton>
          </div>

          {/* 설치 */}
          <div className="mt-4 border-t border-[#2B2F37] pt-4">
            <p className="mb-2 text-xs text-[#8B97AD]">설치 (바이너리 다운로드 + 디렉터리 구성)</p>
            <NeuButton size="sm" variant="glass" onClick={handleInstall} disabled={!sessionActive}>
              <Download className="h-3.5 w-3.5" />
              설치 실행
            </NeuButton>
          </div>

          {installJobId && (
            <div className="mt-4 border-t border-[#2B2F37] pt-4">
              <p className="mb-2 text-xs font-medium text-[#E2E8F2]">설치 진행 상황</p>
              <InstallJobMonitor jobId={installJobId} onDone={handleInstallDone} />
            </div>
          )}

          {/* 삭제 */}
          <div className="mt-4 border-t border-[#2B2F37] pt-4">
            {!showDeleteConfirm ? (
              <NeuButton
                size="sm"
                variant="danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                에이전트 삭제
              </NeuButton>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-[#EF4444]">정말 삭제하시겠습니까?</p>
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
        {agent.agent_type !== 'node_exporter' && (
          <NeuCard>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#E2E8F2]">설정 파일</h2>
              <span className="text-xs text-[#8B97AD]">{agent.config_path}</span>
            </div>

            {configContent === null ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <p className="text-sm text-[#8B97AD]">설정 파일을 불러오려면 아래 버튼을 누르세요.</p>
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
                <div className="flex justify-between items-center">
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
                  <p className="text-xs text-[#F59E0B]">저장되지 않은 변경사항이 있습니다.</p>
                )}
              </div>
            )}
          </NeuCard>
        )}
      </div>

      {showSSHModal && (
        <SSHSessionModal
          defaultHost={agent.host}
          defaultUsername={agent.ssh_username}
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
      <dt className="w-24 shrink-0 text-[#8B97AD]">{label}</dt>
      <dd className="break-all text-[#E2E8F2]">{value}</dd>
    </div>
  )
}
