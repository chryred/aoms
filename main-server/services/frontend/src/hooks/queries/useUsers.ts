import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

export const usersQueryKey = ['auth', 'users'] as const

export function useUsers() {
  const user = useAuthStore((s) => s.user)
  return useQuery({
    queryKey: usersQueryKey,
    queryFn: authApi.getUsers,
    staleTime: 30_000,
    enabled: user?.role === 'admin',
  })
}
