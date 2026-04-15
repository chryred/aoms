import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'
import { Terminal, Plus, Lock, LogOut, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { AgentCard } from '@/components/agent/AgentCard'
import { SSHSessionModal } from '@/components/agent/SSHSessionModal'
import { AgentFormModal } from '@/components/agent/AgentFormModal'
import { useAgents } from '@/hooks/queries/useAgents'
import { useSystems } from '@/hooks/queries/useSystems'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import { agentsApi } from '@/api/agents'
import { qk } from '@/constants/queryKeys'
import { cn } from '@/lib/utils'
import type { AgentType } from '@/types/agent'

const AGENT_TYPE_OPTIONS: Array<{ value: AgentType | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'synapse_agent', label: 'Synapse 수집기' },
  { value: 'db', label: 'DB 수집기' },
]

type HealthFilter = 'all' | 'stale'
const isHealthFilter = (v: string): v is HealthFilter => v === 'all' || v === 'stale'

export function AgentListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const healthParam = searchParams.get('health') ?? 'all'
  const healthFilter: HealthFilter = isHealthFilter(healthParam) ? healthParam : 'all'

  const [filterType, setFilterType] = useState<AgentType | 'all'>('all')
  const [showSSHModal, setShowSSHModal] = useState(false)
  const [showFormModal, setShowFormModal] = useState(false)

  const { token, host, username, isValid, clearSession } = useSSHSessionStore()
  const sessionActive = isValid()

  const { data: agents, isLoading: agentsLoading, isError, refetch } = useAgents()
  const { data: systems, isLoading: systemsLoading } = useSystems()
  const isLoading = agentsLoading || systemsLoading

  // stale 필터가 켜져 있을 때만 각 에이전트의 live-status를 batch 조회
  const liveStatusQueries = useQueries({
    queries: (agents ?? []).map((agent) => ({
      queryKey: qk.agentLiveStatus(agent.id),
      queryFn: () => agentsApi.getLiveStatus(agent.id),
      enabled:
        healthFilter === 'stale' &&
        (agent.agent_type === 'synapse_agent' || agent.agent_type === 'db'),
      staleTime: 55_000,
      refetchInterval: 60_000 as const,
    })),
  })

  // agent_id → 수집 여부 (collecting 인가)
  const liveCollectingMap = useMemo(() => {
    if (healthFilter !== 'stale' || !agents) return null
    const map = new Map<number, boolean>()
    agents.forEach((agent, idx) => {
      const q = liveStatusQueries[idx]
      const ls = q?.data?.live_status
      // collecting 이면 true (건강), 그 외(delayed/stale/no_data)는 false(stale로 간주)
      map.set(agent.id, ls === 'collecting')
    })
    return map
  }, [agents, liveStatusQueries, healthFilter])

  const liveLoading =
    healthFilter === 'stale' && liveStatusQueries.some((q) => q.isLoading || q.isFetching)

  const visibleAgents = useMemo(() => {
    if (!agents) return []
    return agents.filter((a) => {
      if (filterType !== 'all' && a.agent_type !== filterType) return false
      if (healthFilter === 'stale' && liveCollectingMap) {
        // live-status 조회 대상이 아닌 타입은 제외 (예: 미지원 타입)
        if (a.agent_type !== 'synapse_agent' && a.agent_type !== 'db') return false
        // collecting = true → 건강. 숨김.
        if (liveCollectingMap.get(a.id) === true) return false
      }
      return true
    })
  }, [agents, filterType, healthFilter, liveCollectingMap])

  const grouped = useMemo(() => {
    if (!systems) return []
    const visibleIds = new Set(visibleAgents.map((a) => a.id))
    return systems
      .map((system) => ({
        system,
        agents: visibleAgents.filter((a) => a.system_id === system.id && visibleIds.has(a.id)),
      }))
      .filter((g) => g.agents.length > 0)
  }, [visibleAgents, systems])

  const updateHealthFilter = (next: HealthFilter) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'all') params.delete('health')
    else params.set('health', next)
    setSearchParams(params, { replace: true })
  }

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

  return (
    <div>
      <PageHeader
        title="에이전트 관리"
        description="Synapse 수집기 / DB 수집기 설치·제어"
        action={
          <div className="flex items-center gap-2">
            {sessionActive ? (
              <>
                <div className="text-normal flex items-center gap-1.5 rounded-sm bg-[rgba(34,197,94,0.08)] px-3 py-1.5 text-xs">
                  <Lock className="h-3 w-3" />
                  {username}@{host}
                </div>
                <NeuButton variant="ghost" size="sm" onClick={handleLogout}>
                  <LogOut className="h-3.5 w-3.5" />
                  세션 종료
                </NeuButton>
              </>
            ) : (
              <NeuButton variant="glass" size="sm" onClick={() => setShowSSHModal(true)}>
                <Lock className="h-3.5 w-3.5" />
                SSH 세션 등록
              </NeuButton>
            )}
            <NeuButton onClick={() => setShowFormModal(true)}>
              <Plus className="h-4 w-4" />
              에이전트 등록
            </NeuButton>
          </div>
        }
      />

      {/* stale 필터 배너 */}
      {healthFilter === 'stale' && (
        <div className="mb-6 flex items-center gap-3 rounded-sm border border-[rgba(239,68,68,0.20)] bg-[rgba(239,68,68,0.06)] px-4 py-3">
          <AlertCircle className="text-critical h-4 w-4 shrink-0" />
          <p className="text-critical text-sm">
            수집이 중단된 에이전트만 표시 중입니다
            {liveLoading && <span className="text-text-secondary ml-2">(조회 중...)</span>}
          </p>
          <NeuButton
            size="sm"
            variant="ghost"
            onClick={() => updateHealthFilter('all')}
            className="ml-auto shrink-0"
          >
            전체 보기
          </NeuButton>
        </div>
      )}

      {/* 세션 안내 배너 */}
      {!sessionActive && (
        <div className="mb-6 flex items-center gap-3 rounded-sm border border-[rgba(245,158,11,0.20)] bg-[rgba(245,158,11,0.06)] px-4 py-3">
          <Lock className="text-warning h-4 w-4 shrink-0" />
          <p className="text-warning text-sm">
            에이전트 제어(실행·중지·설정 변경)는 SSH 세션 등록 후 사용 가능합니다.
          </p>
          <NeuButton
            size="sm"
            variant="ghost"
            onClick={() => setShowSSHModal(true)}
            className="ml-auto shrink-0"
          >
            등록하기
          </NeuButton>
        </div>
      )}

      {/* 필터 */}
      <div className="mb-6">
        <div
          className="bg-bg-base shadow-neu-pressed inline-flex gap-1 rounded-sm p-1"
          role="group"
          aria-label="에이전트 타입 필터"
        >
          {AGENT_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilterType(opt.value as AgentType | 'all')}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium transition-all',
                'focus:ring-accent focus:ring-offset-bg-base focus:ring-1 focus:outline-none',
                filterType === opt.value
                  ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                  : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LoadingSkeleton shape="card" count={4} />}
      {isError && <ErrorCard onRetry={refetch} />}

      {!isLoading && !isError && visibleAgents.length === 0 && (
        <EmptyState
          icon={<Terminal className="text-text-secondary h-12 w-12" />}
          title={
            healthFilter === 'stale'
              ? '수집이 중단된 에이전트가 없습니다'
              : '등록된 에이전트가 없습니다'
          }
          description={
            healthFilter === 'stale'
              ? '모든 에이전트가 정상 수집 중입니다.'
              : '에이전트 등록 버튼을 눌러 수집기를 추가하세요.'
          }
          cta={
            healthFilter === 'stale'
              ? { label: '전체 보기', onClick: () => updateHealthFilter('all') }
              : { label: '에이전트 등록', onClick: () => setShowFormModal(true) }
          }
        />
      )}

      {!isLoading && !isError && grouped.length > 0 && (
        <div className="flex flex-col gap-8">
          {grouped.map(({ system, agents: systemAgents }) => (
            <section key={system.id}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-text-primary text-base font-bold">{system.display_name}</h2>
                <span className="text-accent inline-flex items-center rounded-full bg-[rgba(0,212,255,0.10)] px-2 py-0.5 text-xs">
                  {systemAgents.length}개
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {systemAgents.map((agent) => (
                  <AgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {showSSHModal && (
        <SSHSessionModal
          onSuccess={() => setShowSSHModal(false)}
          onClose={() => setShowSSHModal(false)}
        />
      )}

      {showFormModal && systems && systems.length > 0 && (
        <AgentFormModal
          systems={systems}
          onClose={() => setShowFormModal(false)}
          onCreated={() => {
            setShowFormModal(false)
            refetch()
          }}
        />
      )}
    </div>
  )
}
