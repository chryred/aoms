import { useNavigate } from 'react-router-dom'
import { Terminal, Settings, ChevronRight } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { AgentStatusBadge } from './AgentStatusBadge'
import { ROUTES } from '@/constants/routes'
import { useAgentStatus } from '@/hooks/queries/useAgents'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import type { AgentInstance, AgentType } from '@/types/agent'

const AGENT_TYPE_LABEL: Record<AgentType, string> = {
  alloy: 'Alloy',
  node_exporter: 'Node Exporter',
  jmx_exporter: 'JMX Exporter',
}

interface AgentCardProps {
  agent: AgentInstance
}

export function AgentCard({ agent }: AgentCardProps) {
  const navigate = useNavigate()
  const sessionActive = useSSHSessionStore((s) => s.isValid())

  // SSH 세션이 있을 때만 실시간 상태 조회 (30초 폴링)
  const { data: statusData } = useAgentStatus(agent.id, sessionActive)
  const status = statusData?.status ?? agent.status

  return (
    <NeuCard
      onClick={() => navigate(ROUTES.agentDetail(agent.id))}
      className="flex items-center justify-between gap-4 p-4"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[rgba(0,212,255,0.08)]">
          {agent.agent_type === 'alloy' ? (
            <Terminal className="h-4 w-4 text-[#00D4FF]" />
          ) : (
            <Settings className="h-4 w-4 text-[#00D4FF]" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#E2E8F2]">
              {AGENT_TYPE_LABEL[agent.agent_type]}
            </span>
            <AgentStatusBadge status={status} />
            {sessionActive && !statusData && (
              <span className="text-[10px] text-[#8B97AD]">조회 중...</span>
            )}
          </div>
          <p className="truncate text-xs text-[#8B97AD]">
            {agent.host} · {agent.ssh_username} · {agent.install_path}
          </p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-[#8B97AD]" />
    </NeuCard>
  )
}
