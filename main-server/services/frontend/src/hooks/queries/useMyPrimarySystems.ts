import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/api/auth'
import { qk } from '@/constants/queryKeys'

export function useMyPrimarySystems() {
  return useQuery({
    queryKey: qk.myPrimarySystems(),
    queryFn: authApi.myPrimarySystems,
    staleTime: 60_000,
  })
}
