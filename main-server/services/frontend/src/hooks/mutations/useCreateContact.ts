import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contactsApi } from '@/api/contacts'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'
import type { ContactCreate } from '@/types/contact'

export function useCreateContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ContactCreate) => contactsApi.createContact(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.contacts() })
      toast.success('담당자가 등록되었습니다')
    },
    onError: () => toast.error('담당자 등록에 실패했습니다'),
  })
}
