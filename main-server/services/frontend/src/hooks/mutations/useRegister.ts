import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import type { RegisterRequest } from '@/types/auth'

export function useRegister() {
  return useMutation({
    mutationFn: (body: RegisterRequest) => authApi.register(body),
  })
}
