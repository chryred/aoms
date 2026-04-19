import { useMutation, useQueryClient } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { usersQueryKey } from '@/hooks/queries/useUsers'
import toast from 'react-hot-toast'

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => authApi.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersQueryKey })
      toast.success('사용자가 삭제되었습니다')
    },
    onError: (err: Error) => {
      const msg = (err as { message?: string })?.message
      toast.error(msg ?? '사용자 삭제에 실패했습니다')
    },
  })
}
