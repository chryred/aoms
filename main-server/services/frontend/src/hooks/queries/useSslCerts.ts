import { useQuery } from '@tanstack/react-query'
import { sslApi } from '@/api/ssl'
import { qk } from '@/constants/queryKeys'

export function useSslCertStatus() {
  return useQuery({
    queryKey: qk.ssl.certStatus(),
    queryFn: () => sslApi.getCertStatus(),
    staleTime: 55_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
