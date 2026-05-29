import { useQuery } from '@tanstack/react-query'
import { sslApi } from '@/api/ssl'
import { qk } from '@/constants/queryKeys'

export function useSslServers(params?: { network_zone?: string; status?: string }) {
  return useQuery({
    queryKey: qk.ssl.servers(params as Record<string, string>),
    queryFn: () => sslApi.getServers(params),
    staleTime: 30_000,
  })
}

export function useSslHaGroups() {
  return useQuery({
    queryKey: qk.ssl.haGroups(),
    queryFn: () => sslApi.getHaGroups(),
    staleTime: 60_000,
  })
}

export function useSslDeployments(params?: { server_id?: number; limit?: number }) {
  return useQuery({
    queryKey: qk.ssl.deployments(params),
    queryFn: () => sslApi.getDeployments(params),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
