import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { chatExecutorConfigsApi, chatToolsApi } from '@/api/chatTools'
import { qk } from '@/constants/queryKeys'

export function useToggleChatTool() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, is_enabled }: { name: string; is_enabled: boolean }) =>
      chatToolsApi.toggle(name, is_enabled),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.chat.tools() })
      toast.success(`${data.display_name} ${data.is_enabled ? '활성화' : '비활성화'}됨`)
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status: number } })?.response?.status
      if (status === 422) {
        toast.error('자격증명을 먼저 저장해야 도구를 활성화할 수 있습니다.')
      } else {
        toast.error('도구 상태 변경 실패')
      }
    },
  })
}

export function useSaveChatExecutorConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ executor, config }: { executor: string; config: Record<string, unknown> }) =>
      chatExecutorConfigsApi.save(executor, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.chat.executorConfigs() })
      toast.success('저장되었습니다')
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        '저장 실패'
      toast.error(detail)
    },
  })
}

export function useTestChatExecutor() {
  return useMutation({
    mutationFn: ({ executor, config }: { executor: string; config?: Record<string, string> }) =>
      chatExecutorConfigsApi.test(executor, config),
  })
}
