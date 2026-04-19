import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersQueryKey } from '@/hooks/queries/useUsers'
import toast from 'react-hot-toast'
import type { UserAdminUpdateRequest } from '@/types/auth'

export function useUpdateUser(userId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UserAdminUpdateRequest) => authApi.updateUser(userId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey })
      toast.success('사용자 정보가 수정되었습니다')
    },
    onError: () => toast.error('수정에 실패했습니다'),
  })
}
