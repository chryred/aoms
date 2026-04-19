import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/api/auth'

export const approvedUsersQueryKey = ['approvedUsers'] as const

export function useApprovedUsers() {
  return useQuery({
    queryKey: approvedUsersQueryKey,
    queryFn: authApi.getApprovedUsers,
    staleTime: 60_000,
  })
}
