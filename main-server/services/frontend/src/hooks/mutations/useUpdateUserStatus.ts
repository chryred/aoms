import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersQueryKey } from '@/hooks/queries/useUsers'
import toast from 'react-hot-toast'
import type { UserStatusUpdateRequest } from '@/types/auth'

export function useUpdateUserStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserStatusUpdateRequest }) =>
      authApi.updateUserStatus(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey })
      toast.success('사용자 상태가 변경되었습니다')
    },
    onError: () => toast.error('상태 변경에 실패했습니다'),
  })
}
