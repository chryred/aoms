import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contactsApi } from '@/api/contacts'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'
import type { ContactCreate } from '@/types/contact'

export function useUpdateContact(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Partial<ContactCreate>) => contactsApi.updateContact(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.contacts() })
      qc.invalidateQueries({ queryKey: qk.contact(id) })
      toast.success('담당자 정보가 수정되었습니다')
    },
    onError: () => toast.error('담당자 수정에 실패했습니다'),
  })
}
