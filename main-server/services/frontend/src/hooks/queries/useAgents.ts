import { useQuery } from '@tanstack/react-query'
import { agentsApi, type AgentFilterParams } from '@/api/agents'
import { qk } from '@/constants/queryKeys'
import { useSSHSessionStore } from '@/store/sshSessionStore'
import type { AgentType } from '@/types/agent'

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

/** Prometheus 기반 라이브 상태 — synapse_agent / oracle_db (SSH 불필요, 60초 폴링) */
export function useLiveStatus(agentId: number, agentType: AgentType) {
  const enabled = agentType === 'synapse_agent' || agentType === 'oracle_db'
  return useQuery({
    queryKey: qk.agentLiveStatus(agentId),
    queryFn: () => agentsApi.getLiveStatus(agentId),
    enabled,
    staleTime: 55_000,
    refetchInterval: enabled ? 60_000 : false,
  })
}

/** 시스템 단위 Prometheus 기반 수집 여부 (대시보드 상세용, 60초 폴링) */
export function useSystemLiveStatus(systemId: number | undefined) {
  return useQuery({
    queryKey: qk.agentSystemLive(systemId ?? 0),
    queryFn: () => agentsApi.getSystemLiveStatus(systemId!),
    enabled: !!systemId,
    staleTime: 55_000,
    refetchInterval: 60_000,
  })
}

/** 전체 에이전트 수집 상태 요약 (대시보드용, 60초 폴링) */
export function useAgentHealthSummary() {
  return useQuery({
    queryKey: qk.agentHealthSummary,
    queryFn: () => agentsApi.getHealthSummary(),
    staleTime: 55_000,
    refetchInterval: 60_000,
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
