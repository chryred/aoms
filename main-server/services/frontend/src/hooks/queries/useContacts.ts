import { useQuery } from '@tanstack/react-query'
import { contactsApi } from '@/api/contacts'
import { qk } from '@/constants/queryKeys'

export function useContacts() {
  return useQuery({
    queryKey: qk.contacts(),
    queryFn: () => contactsApi.getContacts(),
    staleTime: 120_000,
  })
}

export function useContact(id: number) {
  return useQuery({
    queryKey: qk.contact(id),
    queryFn: () => contactsApi.getContact(id),
    staleTime: 120_000,
    enabled: id > 0,
  })
}

export function useSystemContacts(systemId: number) {
  return useQuery({
    queryKey: qk.systemContacts(systemId),
    queryFn: () => contactsApi.getSystemContacts(systemId),
    staleTime: 60_000,
    enabled: systemId > 0,
  })
}
