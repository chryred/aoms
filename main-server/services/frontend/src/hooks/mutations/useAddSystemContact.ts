import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contactsApi } from '@/api/contacts'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'
import type { SystemContactCreate } from '@/types/contact'

export function useAddSystemContact(systemId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SystemContactCreate) => contactsApi.addSystemContact(systemId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systemContacts(systemId) })
      qc.invalidateQueries({ queryKey: qk.contacts() })
      toast.success('담당자가 시스템에 연결되었습니다')
    },
    onError: () => toast.error('담당자 연결에 실패했습니다'),
  })
}
