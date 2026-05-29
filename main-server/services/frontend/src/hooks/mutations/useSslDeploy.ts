import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sslApi } from '@/api/ssl'
import { qk } from '@/constants/queryKeys'

export function useDeployServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (serverId: number) => sslApi.deployServer(serverId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.ssl.deployments() })
    },
  })
}

export function useCreateSslServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: sslApi.createServer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.ssl.servers() })
    },
  })
}

export function useUpdateSslServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof sslApi.updateServer>[1] }) =>
      sslApi.updateServer(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.ssl.servers() })
    },
  })
}

export function useDeleteSslServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => sslApi.deleteServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.ssl.servers() })
    },
  })
}
