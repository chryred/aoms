import { useState, useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Terminal,
  Trash2,
  RefreshCw,
  Lock,
  LogOut,
  AlertCircle,
  Upload,
  ChevronDown,
} from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { IconButton } from '@/components/neumorphic/IconButton'
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
          message:
            typeof data.detail === 'string'
              ? data.detail
              : 'SSH 세션이 만료되었습니다. 다시 등록해 주세요.',
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
  return e instanceof Error
    ? { message: e.message }
    : { message: '알 수 없는 오류가 발생했습니다.' }
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
  const [usageOpen, setUsageOpen] = useState(() => {
    const saved = localStorage.getItem('cli-manager.usage-open')
    return saved === null ? true : saved === '1'
  })
  const errorModalConfirmRef = useRef<HTMLButtonElement>(null)
  const errorModalTriggerRef = useRef<HTMLElement | null>(null)

  const toggleUsage = useCallback(() => {
    setUsageOpen((prev) => {
      const next = !prev
      localStorage.setItem('cli-manager.usage-open', next ? '1' : '0')
      return next
    })
  }, [])

  const refreshList = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['agents', 'cli'] })
  }, [qc])

  useEffect(() => {
    if (!errorModal) return
    errorModalTriggerRef.current = document.activeElement as HTMLElement | null
    errorModalConfirmRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setErrorModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      errorModalTriggerRef.current?.focus?.()
    }
  }, [errorModal])

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
        title="CLI 배포 관리"
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
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  세션 종료
                </NeuButton>
              </>
            ) : (
              <NeuButton variant="glass" size="sm" onClick={() => setShowSshModal(true)}>
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                SSH 세션 등록
              </NeuButton>
            )}
            <NeuButton onClick={() => setShowAddModal(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              서버 등록
            </NeuButton>
          </div>
        }
      />

      {/* SSH 세션 없을 때 경고 배너 */}
      {!sessionActive && (
        <div className="border-warning-border bg-warning-card-bg flex items-center gap-3 rounded-sm border px-4 py-3">
          <Lock className="text-warning h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-warning text-sm">CLI 배포는 SSH 세션 등록 후 사용 가능합니다.</p>
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
          <IconButton onClick={refreshList} aria-label="목록 새로고침" title="새로고침">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>

        {isLoading ? (
          <p className="text-text-secondary py-4 text-center text-sm">로딩 중...</p>
        ) : agents.length === 0 ? (
          <div className="py-8 text-center">
            <Terminal className="text-text-disabled mx-auto mb-2 h-8 w-8" aria-hidden="true" />
            <p className="text-text-secondary text-sm">등록된 서버가 없습니다.</p>
            <p className="text-text-secondary mt-1 text-xs">서버 등록 버튼으로 추가하세요.</p>
          </div>
        ) : (
          <div className="divide-border divide-y">
            {agents.map((agent) => {
              const isInstalled = agent.status === 'installed' || agent.status === 'running'
              const sys = systems.find((s) => s.id === agent.system_id)
              const isDeploying = deployState?.agentId === agent.id
              const deployTitle = !sessionActive
                ? 'SSH 세션을 먼저 등록하세요'
                : isDeploying
                  ? '배포 진행 중'
                  : isInstalled
                    ? `${agent.host} — 기존 바이너리를 새 버전으로 덮어씁니다`
                    : `${agent.host}에 신규 배포`
              const deployLabel = isDeploying ? '배포 중...' : isInstalled ? '재배포' : '배포'
              return (
                <div
                  key={agent.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-text-primary truncate text-sm font-medium">{agent.host}</p>
                      {sys ? (
                        <span className="bg-bg-deep text-text-primary rounded-sm px-1.5 py-0.5 text-xs">
                          {sys.display_name}
                          <span className="text-text-secondary ml-1 font-mono">
                            ({sys.system_name})
                          </span>
                        </span>
                      ) : (
                        <span className="text-warning bg-warning-bg border-warning-border rounded-sm border px-1.5 py-0.5 text-xs">
                          시스템 미지정
                        </span>
                      )}
                    </div>
                    <p className="text-text-secondary mt-0.5 text-xs">
                      {agent.install_path || '~/bin/synapse'}
                      {agent.updated_at && (
                        <span className="ml-2">
                          · 최근 업데이트: {formatKST(agent.updated_at, 'datetime')}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        isInstalled ? 'bg-normal/10 text-normal' : 'text-text-secondary bg-surface'
                      }`}
                    >
                      {isInstalled ? '설치됨' : '미설치'}
                    </span>

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
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDeploy(agent)}
                          disabled={!sessionActive}
                          loading={isDeploying}
                          title={deployTitle}
                        >
                          {!isDeploying &&
                            (isInstalled ? (
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                            ))}
                          {deployLabel}
                        </NeuButton>
                        <IconButton
                          onClick={() => setDeleteConfirm(agent.id)}
                          aria-label={`${agent.host} 삭제`}
                          title="삭제"
                          tone="critical"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </NeuCard>

      {/* 사용 안내 */}
      <NeuCard>
        <button
          type="button"
          onClick={toggleUsage}
          aria-expanded={usageOpen}
          aria-controls="cli-usage-panel"
          className="text-text-primary hover:bg-hover-subtle focus:ring-accent -m-1 flex w-full items-center justify-between rounded-sm p-1 text-sm font-semibold transition-colors duration-150 focus:ring-1 focus:outline-none"
        >
          <span>CLI 사용법</span>
          <ChevronDown
            className={`text-text-secondary h-4 w-4 transition-transform duration-150 ${
              usageOpen ? '' : '-rotate-90'
            }`}
            aria-hidden="true"
          />
        </button>
        {usageOpen && (
          <div id="cli-usage-panel" className="mt-3 space-y-2">
            {[
              ['초기 설정', 'synapse login'],
              ['단방향 질의', 'synapse ask "ORA-01555 에러 즉각 조치 알려줘"'],
              ['시스템 컨텍스트', 'synapse ask --system cms "현재 알림 상황"'],
              ['로그 파이프', 'tail -100 /app/error.log | synapse ask "분석해줘"'],
              ['대화형 모드', 'synapse chat'],
              ['새 대화', 'synapse chat --new'],
            ].map(([label, cmd]) => (
              <div key={label} className="flex items-start gap-3">
                <span className="text-text-secondary min-w-[7rem] shrink-0 text-xs">{label}</span>
                <code className="bg-bg-deep text-text-primary rounded-sm px-2 py-0.5 font-mono text-xs break-all">
                  {cmd}
                </code>
              </div>
            ))}
          </div>
        )}
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
              <NeuButton ref={errorModalConfirmRef} size="sm" onClick={() => setErrorModal(null)}>
                확인
              </NeuButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
