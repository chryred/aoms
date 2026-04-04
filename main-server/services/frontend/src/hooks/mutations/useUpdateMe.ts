import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { qk } from '@/constants/queryKeys'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import type { UserUpdateRequest } from '@/types/auth'

export function useUpdateMe() {
  const qc = useQueryClient()
  const login = useAuthStore((s) => s.login)
  const token = useAuthStore((s) => s.token)

  return useMutation({
    mutationFn: (body: UserUpdateRequest) => authApi.updateMe(body),
    onSuccess: (updatedUser) => {
      if (token) {
        login({ access_token: token, token_type: 'bearer', user: updatedUser })
      }
      qc.invalidateQueries({ queryKey: qk.me() })
      toast.success('프로필이 업데이트되었습니다')
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status: number } })?.response?.status
      if (status === 401) {
        toast.error('현재 비밀번호가 올바르지 않습니다')
      } else {
        toast.error('프로필 수정에 실패했습니다')
      }
    },
  })
}
