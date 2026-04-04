import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contactsApi } from '@/api/contacts'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'

export function useDeleteContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => contactsApi.deleteContact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.contacts() })
      toast.success('담당자가 삭제되었습니다')
    },
    onError: () => toast.error('담당자 삭제에 실패했습니다'),
  })
}
