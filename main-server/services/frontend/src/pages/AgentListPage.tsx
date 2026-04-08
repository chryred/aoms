import { useMemo, useState } from 'react'
import { Terminal, Plus, Lock, LogOut } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { AgentType } from '@/types/agent'

const AGENT_TYPE_OPTIONS: Array<{ value: AgentType | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'alloy', label: 'Alloy' },
  { value: 'node_exporter', label: 'Node Exporter' },
  { value: 'jmx_exporter', label: 'JMX Exporter' },
]

export function AgentListPage() {
  const [filterType, setFilterType] = useState<AgentType | 'all'>('all')
  const [showSSHModal, setShowSSHModal] = useState(false)
  const [showFormModal, setShowFormModal] = useState(false)

  const { token, host, username, isValid, clearSession } = useSSHSessionStore()
  const sessionActive = isValid()

  const { data: agents, isLoading: agentsLoading, isError, refetch } = useAgents()
  const { data: systems, isLoading: systemsLoading } = useSystems()
  const isLoading = agentsLoading || systemsLoading

  const grouped = useMemo(() => {
    if (!agents || !systems) return []
    return systems
      .map((system) => ({
        system,
        agents: agents.filter(
          (a) =>
            a.system_id === system.id &&
            (filterType === 'all' || a.agent_type === filterType),
        ),
      }))
      .filter((g) => g.agents.length > 0)
  }, [agents, systems, filterType])

  const allAgentsFiltered = useMemo(() => {
    if (!agents) return []
    return agents.filter((a) => filterType === 'all' || a.agent_type === filterType)
  }, [agents, filterType])

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
        description="수집기(Alloy, Node Exporter, JMX Exporter) 설치·제어"
        action={
          <div className="flex items-center gap-2">
            {sessionActive ? (
              <>
                <div className="flex items-center gap-1.5 rounded-sm bg-[rgba(34,197,94,0.08)] px-3 py-1.5 text-xs text-[#22C55E]">
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

      {/* 세션 안내 배너 */}
      {!sessionActive && (
        <div className="mb-6 flex items-center gap-3 rounded-sm border border-[rgba(245,158,11,0.20)] bg-[rgba(245,158,11,0.06)] px-4 py-3">
          <Lock className="h-4 w-4 shrink-0 text-[#F59E0B]" />
          <p className="text-sm text-[#F59E0B]">
            에이전트 제어(실행·중지·설정 변경)는 SSH 세션 등록 후 사용 가능합니다.
          </p>
          <NeuButton size="sm" variant="ghost" onClick={() => setShowSSHModal(true)} className="ml-auto shrink-0">
            등록하기
          </NeuButton>
        </div>
      )}

      {/* 필터 */}
      <div className="mb-6">
        <div
          className="inline-flex gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]"
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
                'focus:ring-1 focus:ring-[#00D4FF] focus:ring-offset-[#1E2127] focus:outline-none',
                filterType === opt.value
                  ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                  : 'text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#E2E8F2]',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <LoadingSkeleton shape="card" count={4} />}
      {isError && <ErrorCard onRetry={refetch} />}

      {!isLoading && !isError && allAgentsFiltered.length === 0 && (
        <EmptyState
          icon={<Terminal className="h-12 w-12 text-[#8B97AD]" />}
          title="등록된 에이전트가 없습니다"
          description="에이전트 등록 버튼을 눌러 수집기를 추가하세요."
          cta={{ label: '에이전트 등록', onClick: () => setShowFormModal(true) }}
        />
      )}

      {!isLoading && !isError && grouped.length > 0 && (
        <div className="flex flex-col gap-8">
          {grouped.map(({ system, agents: systemAgents }) => (
            <section key={system.id}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-base font-bold text-[#E2E8F2]">{system.display_name}</h2>
                <span className="text-sm text-[#8B97AD]">{system.host}</span>
                <span className="inline-flex items-center rounded-full bg-[rgba(0,212,255,0.10)] px-2 py-0.5 text-xs text-[#00D4FF]">
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
