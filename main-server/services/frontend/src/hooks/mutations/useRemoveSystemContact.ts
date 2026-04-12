import { useMutation, useQueryClient } from '@tanstack/react-query'
import { contactsApi } from '@/api/contacts'
import { qk } from '@/constants/queryKeys'
import toast from 'react-hot-toast'

export function useRemoveSystemContact(systemId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (contactId: number) => contactsApi.removeSystemContact(systemId, contactId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.systemContacts(systemId) })
      qc.invalidateQueries({ queryKey: qk.contacts() })
      toast.success('담당자 연결이 해제되었습니다')
    },
    onError: () => toast.error('담당자 연결 해제에 실패했습니다'),
  })
}
