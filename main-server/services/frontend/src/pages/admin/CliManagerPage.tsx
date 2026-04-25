import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Terminal, Trash2, RefreshCw, CheckCircle2, CircleDashed, Lock, LogOut, AlertCircle } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { PageHeader } from '@/components/common/PageHeader'
import { SSHSessionModal } from '@/components/agent/SSHSessionModal'
import { InstallJobMonitor } from '@/components/agent/InstallJobMonitor'
import { CliServerFormModal } from '@/components/agent/CliServerFormModal'
import { agentsApi } from '@/api/agents'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import { useQuery } from '@tanstack/react-query'
import { useSystems } from '@/hooks/queries/useSystems'
import { formatKST } from '@/lib/utils'
import type { AgentInstance } from '@/types/agent'
import type { HTTPError } from 'ky'
import { useAuthStore } from '@/store/authStore'

function useCliAgents() {
  return useQuery({
    queryKey: ['agents', 'cli'],
    queryFn: () => agentsApi.getAgents({ agent_type: 'cli' }),
    refetchInterval: 10_000,
  })
}

interface DeployState {
  agentId: number
  jobId: string | null
}

interface ErrorModal {
  title: string
  message: string
}

async function extractErrorMessage(
  e: unknown,
): Promise<{ message: string; clearSsh?: boolean } | null> {
  if (e && typeof e === 'object' && 'response' in e) {
    const httpErr = e as HTTPError
    if (httpErr.response.status === 401) {
      // JWT 만료 시 ky-client가 authStore.logout() 후 /login 리다이렉트
      // authStore 토큰이 이미 지워졌으면 JWT 만료 → 모달 불필요
      if (!useAuthStore.getState().token) return null
      // 토큰이 아직 있으면 SSH 세션 만료 401
      try {
        const data = (await httpErr.response.json()) as { detail?: string }
        return {
          message: typeof data.detail === 'string' ? data.detail : 'SSH 세션이 만료되었습니다. 다시 등록해 주세요.',
          clearSsh: true,
        }
      } catch {
        return { message: 'SSH 세션이 만료되었습니다. 다시 등록해 주세요.', clearSsh: true }
      }
    }
    try {
      const data = (await httpErr.response.json()) as { detail?: string | { msg: string }[] }
      if (typeof data.detail === 'string') return { message: data.detail }
      if (Array.isArray(data.detail)) return { message: data.detail.map((d) => d.msg).join(', ') }
    } catch {
      // ignore parse error
    }
    return { message: httpErr.response.statusText || '서버 오류가 발생했습니다.' }
  }
  return e instanceof Error ? { message: e.message } : { message: '알 수 없는 오류가 발생했습니다.' }
}

export function CliManagerPage() {
  const qc = useQueryClient()
  const { data: agents = [], isLoading } = useCliAgents()
  const { data: systems = [] } = useSystems()
  const { token, host, username, isValid, clearSession } = useSSHSessionStore()
  const sessionActive = isValid()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showSshModal, setShowSshModal] = useState(false)
  const [deployState, setDeployState] = useState<DeployState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [errorModal, setErrorModal] = useState<ErrorModal | null>(null)

  const refreshList = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['agents', 'cli'] })
  }, [qc])

  async function handleLogout() {
    if (token) {
      try {
        await agentsApi.deleteSession(token)
      } catch {
        // ignore
      }
    }
    clearSession()
  }

  async function handleDeploy(agent: AgentInstance) {
    try {
      const { job_id } = await agentsApi.installAgent(
        { agent_id: agent.id },
        useSSHSessionStore.getState().token!,
      )
      setDeployState({ agentId: agent.id, jobId: job_id })
    } catch (e) {
      const result = await extractErrorMessage(e)
      if (result !== null) {
        if (result.clearSsh) clearSession()
        setErrorModal({ title: '배포 실패', message: result.message })
      }
    }
  }

  async function handleDelete(id: number) {
    try {
      await agentsApi.deleteAgent(id)
      refreshList()
    } catch (e) {
      const result = await extractErrorMessage(e)
      if (result !== null) {
        if (result.clearSsh) clearSession()
        setErrorModal({ title: '삭제 실패', message: result.message })
      }
    } finally {
      setDeleteConfirm(null)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Synapse CLI 배포 관리"
        description="운영 서버에 CLI 바이너리를 배포하고 관리합니다."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {sessionActive ? (
              <>
                <div className="text-normal bg-normal-bg flex min-w-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="max-w-[160px] truncate">
                    {username}@{host}
                  </span>
                </div>
                <NeuButton variant="ghost" size="sm" onClick={handleLogout}>
                  <LogOut className="h-3.5 w-3.5" />
                  세션 종료
                </NeuButton>
              </>
            ) : (
              <NeuButton variant="glass" size="sm" onClick={() => setShowSshModal(true)}>
                <Lock className="h-3.5 w-3.5" />
                SSH 세션 등록
              </NeuButton>
            )}
            <NeuButton onClick={() => setShowAddModal(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              서버 등록
            </NeuButton>
          </div>
        }
      />

      {/* SSH 세션 없을 때 경고 배너 */}
      {!sessionActive && (
        <div className="border-warning-border bg-warning-card-bg flex items-center gap-3 rounded-sm border px-4 py-3">
          <Lock className="text-warning h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-warning text-sm">
            CLI 배포는 SSH 세션 등록 후 사용 가능합니다.
          </p>
          <NeuButton
            size="sm"
            variant="ghost"
            onClick={() => setShowSshModal(true)}
            className="ml-auto shrink-0"
          >
            등록하기
          </NeuButton>
        </div>
      )}

      {/* 배포 진행 모니터 */}
      {deployState?.jobId && (
        <NeuCard>
          <h3 className="text-text-primary mb-3 text-sm font-semibold">배포 진행 상황</h3>
          <InstallJobMonitor
            jobId={deployState.jobId}
            onDone={() => {
              refreshList()
              setDeployState(null)
            }}
          />
        </NeuCard>
      )}

      {/* 서버 목록 */}
      <NeuCard>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-text-primary text-sm font-semibold">배포 서버 목록</h3>
          <button
            onClick={refreshList}
            className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm focus:ring-1 focus:outline-none"
            title="새로고침"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <p className="text-text-secondary py-4 text-center text-sm">로딩 중...</p>
        ) : agents.length === 0 ? (
          <div className="py-8 text-center">
            <Terminal className="text-text-disabled mx-auto mb-2 h-8 w-8" />
            <p className="text-text-secondary text-sm">등록된 서버가 없습니다.</p>
            <p className="text-text-disabled mt-1 text-xs">서버 등록 버튼으로 추가하세요.</p>
          </div>
        ) : (
          <div className="divide-border divide-y">
            {agents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-4 py-3">
                {/* 상태 아이콘 */}
                <div className="shrink-0">
                  {agent.status === 'installed' || agent.status === 'running' ? (
                    <CheckCircle2 className="text-normal h-4 w-4" />
                  ) : (
                    <CircleDashed className="text-text-disabled h-4 w-4" />
                  )}
                </div>

                {/* 서버 정보 */}
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-sm font-medium">
                    {agent.host}
                    {(() => {
                      const sys = systems.find((s) => s.id === agent.system_id)
                      return sys ? (
                        <span className="text-text-secondary ml-2 text-xs font-normal">
                          {sys.display_name}
                        </span>
                      ) : null
                    })()}
                  </p>
                  <p className="text-text-secondary mt-0.5 text-xs">
                    {agent.install_path || '~/bin/synapse'}
                    {agent.updated_at && (
                      <span className="ml-2">
                        · 최근 업데이트: {formatKST(agent.updated_at, 'date')}
                      </span>
                    )}
                  </p>
                </div>

                {/* 상태 뱃지 */}
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    agent.status === 'installed' || agent.status === 'running'
                      ? 'bg-normal/10 text-normal'
                      : 'text-text-secondary bg-surface'
                  }`}
                >
                  {agent.status === 'installed' || agent.status === 'running'
                    ? '설치됨'
                    : '미설치'}
                </span>

                {/* 액션 버튼 */}
                <div className="flex shrink-0 gap-2">
                  {deleteConfirm === agent.id ? (
                    <>
                      <NeuButton
                        variant="ghost"
                        className="text-critical text-xs"
                        onClick={() => handleDelete(agent.id)}
                      >
                        삭제 확인
                      </NeuButton>
                      <NeuButton
                        variant="ghost"
                        className="text-xs"
                        onClick={() => setDeleteConfirm(null)}
                      >
                        취소
                      </NeuButton>
                    </>
                  ) : (
                    <>
                      <NeuButton
                        variant="ghost"
                        className="text-xs"
                        onClick={() => handleDeploy(agent)}
                        disabled={!sessionActive || deployState?.agentId === agent.id}
                        title={!sessionActive ? 'SSH 세션을 먼저 등록하세요' : undefined}
                      >
                        {agent.status === 'installed' || agent.status === 'running'
                          ? '재배포'
                          : '배포'}
                      </NeuButton>
                      <button
                        onClick={() => setDeleteConfirm(agent.id)}
                        className="text-text-secondary hover:text-critical focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
                        title="삭제"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </NeuCard>

      {/* 사용 안내 */}
      <NeuCard>
        <h3 className="text-text-primary mb-3 text-sm font-semibold">CLI 사용법</h3>
        <div className="space-y-2">
          {[
            ['초기 설정', 'synapse login'],
            ['단방향 질의', 'synapse ask "ORA-01555 에러 즉각 조치 알려줘"'],
            ['시스템 컨텍스트', 'synapse ask --system cms "현재 알림 상황"'],
            ['로그 파이프', 'tail -100 /app/error.log | synapse ask "분석해줘"'],
            ['대화형 모드', 'synapse chat'],
            ['새 대화', 'synapse chat --new'],
          ].map(([label, cmd]) => (
            <div key={label} className="flex items-start gap-3">
              <span className="text-text-secondary w-28 shrink-0 text-xs">{label}</span>
              <code className="bg-bg-deep text-text-primary rounded-sm px-2 py-0.5 font-mono text-xs">
                {cmd}
              </code>
            </div>
          ))}
        </div>
      </NeuCard>

      {/* 모달 */}
      {showAddModal && (
        <CliServerFormModal
          systems={systems}
          onSuccess={() => {
            setShowAddModal(false)
            refreshList()
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {showSshModal && (
        <SSHSessionModal
          onSuccess={() => setShowSshModal(false)}
          onClose={() => setShowSshModal(false)}
        />
      )}

      {/* 에러 모달 */}
      {errorModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="error-modal-title"
        >
          <div
            className="bg-overlay absolute inset-0"
            onClick={() => setErrorModal(null)}
            aria-hidden="true"
          />
          <div className="border-border bg-bg-base shadow-neu-flat relative z-10 mx-4 w-full max-w-sm rounded-sm border p-6">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="text-critical h-4 w-4 shrink-0" aria-hidden="true" />
              <h2 id="error-modal-title" className="text-text-primary text-base font-semibold">
                {errorModal.title}
              </h2>
            </div>
            <p className="text-text-secondary mb-6 text-sm break-words">{errorModal.message}</p>
            <div className="flex justify-end">
              <NeuButton size="sm" onClick={() => setErrorModal(null)}>
                확인
              </NeuButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
