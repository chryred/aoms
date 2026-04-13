import { useNavigate } from 'react-router-dom'
import { Settings, ChevronRight } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { AgentStatusBadge } from './AgentStatusBadge'
import { ROUTES } from '@/constants/routes'
import { useLiveStatus } from '@/hooks/queries/useAgents'
import { getAgentTypeLabel } from '@/lib/utils'
import type { AgentInstance, AgentStatus } from '@/types/agent'

interface AgentCardProps {
  agent: AgentInstance
}

export function AgentCard({ agent }: AgentCardProps) {
  const navigate = useNavigate()

  // Prometheus 기반 라이브 상태 (synapse_agent / oracle_db, SSH 불필요)
  const { data: liveStatus, isLoading: liveLoading } = useLiveStatus(agent.id, agent.agent_type)

  const supportsLive = agent.agent_type === 'synapse_agent' || agent.agent_type === 'oracle_db'
  const displayStatus: AgentStatus = liveStatus
    ? liveStatus.live
      ? 'running'
      : 'stopped'
    : agent.status

  return (
    <NeuCard
      onClick={() => navigate(ROUTES.agentDetail(agent.id))}
      className="flex items-center justify-between gap-4 p-4"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="bg-glass-bg flex h-8 w-8 shrink-0 items-center justify-center rounded-sm">
          <Settings className="text-accent h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-text-primary text-sm font-semibold">
              {getAgentTypeLabel(agent.agent_type)}
            </span>
            <AgentStatusBadge status={displayStatus} />
            {supportsLive && liveLoading && (
              <span className="text-text-secondary text-[10px]">조회 중...</span>
            )}
          </div>
          <p className="text-text-secondary truncate text-xs">
            {(() => {
              const labelInfo = (() => {
                try {
                  return JSON.parse(agent.label_info ?? '{}')
                } catch {
                  return {}
                }
              })()
              const instanceRole = labelInfo.instance_role as string | undefined
              const parts = [agent.host, agent.os_type, agent.server_type, instanceRole].filter(
                Boolean,
              )
              return parts.join(' · ')
            })()}
          </p>
        </div>
      </div>
      <ChevronRight className="text-text-secondary h-4 w-4 shrink-0" />
    </NeuCard>
  )
}
