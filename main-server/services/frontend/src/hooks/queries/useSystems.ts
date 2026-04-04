import { useQuery } from '@tanstack/react-query'
import { systemsApi } from '@/api/systems'
import { qk } from '@/constants/queryKeys'

export function useSystems() {
  return useQuery({
    queryKey: qk.systems(),
    queryFn: systemsApi.getSystems,
    staleTime: 60_000,
    refetchInterval: 300_000,
  })
}

export function useSystem(id: number) {
  return useQuery({
    queryKey: qk.system(id),
    queryFn: () => systemsApi.getSystem(id),
    staleTime: 60_000,
    enabled: id > 0,
  })
}
