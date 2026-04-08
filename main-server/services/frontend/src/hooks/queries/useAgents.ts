import { useQuery } from '@tanstack/react-query'
import { agentsApi, type AgentFilterParams } from '@/api/agents'
import { qk } from '@/constants/queryKeys'
import { useSSHSessionStore } from '@/store/sshSessionStore'

export function useAgents(params?: AgentFilterParams) {
  return useQuery({
    queryKey: qk.agents(params),
    queryFn: () => agentsApi.getAgents(params),
    staleTime: 30_000,
  })
}

export function useAgentStatus(agentId: number, enabled = false, refetchInterval = 30_000) {
  const token = useSSHSessionStore((s) => s.token)
  return useQuery({
    queryKey: qk.agentStatus(agentId),
    queryFn: () => agentsApi.getStatus(agentId, token!),
    enabled: enabled && !!token,
    staleTime: 0,
    refetchInterval: enabled ? refetchInterval : false,
  })
}

export function useAgentConfig(agentId: number, enabled = false) {
  const token = useSSHSessionStore((s) => s.token)
  return useQuery({
    queryKey: qk.agentConfig(agentId),
    queryFn: () => agentsApi.getConfig(agentId, token!),
    enabled: enabled && !!token,
    staleTime: 0,
  })
}

export function useInstallJob(jobId: string | null, enabled = false) {
  return useQuery({
    queryKey: qk.installJob(jobId ?? ''),
    queryFn: () => agentsApi.getInstallJob(jobId!),
    enabled: enabled && !!jobId,
    staleTime: 0,
    refetchInterval: enabled ? 2_000 : false,
  })
}
