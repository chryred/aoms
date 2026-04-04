import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersQueryKey } from '@/hooks/queries/useUsers'
import toast from 'react-hot-toast'
import type { UserRoleUpdateRequest } from '@/types/auth'

export function useUpdateUserRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UserRoleUpdateRequest }) =>
      authApi.updateUserRole(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey })
      toast.success('권한이 변경되었습니다')
    },
    onError: () => toast.error('권한 변경에 실패했습니다'),
  })
}
