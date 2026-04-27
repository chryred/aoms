import { useQuery } from '@tanstack/react-query'
import { knowledgeApi } from '@/api/knowledge'
import { qk } from '@/constants/queryKeys'
import type { OperatorNoteListParams, FeedbackListParams } from '@/api/knowledge'

export function useFrequentQuestions(days = 30, threshold = 3) {
  return useQuery({
    queryKey: qk.knowledge.frequentQuestions(days, threshold),
    queryFn: () => knowledgeApi.listFrequentQuestions(days, threshold),
    staleTime: 60_000,
  })
}

export function useOperatorNotes(params?: OperatorNoteListParams) {
  return useQuery({
    queryKey: qk.knowledge.notes(params),
    queryFn: () => knowledgeApi.listOperatorNotes(params),
    staleTime: 30_000,
  })
}

export function useKnowledgeFeedback(params?: FeedbackListParams) {
  return useQuery({
    queryKey: qk.knowledge.corrections(params),
    queryFn: () => knowledgeApi.listFeedback(params),
    staleTime: 30_000,
  })
}

export function useSyncStatus(source?: string) {
  return useQuery({
    queryKey: qk.knowledge.syncStatus(source),
    queryFn: () => knowledgeApi.getSyncStatus(source),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useUploadStatus(jobId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.knowledge.uploadStatus(jobId ?? ''),
    queryFn: () => knowledgeApi.getUploadStatus(jobId as string),
    enabled: !!jobId && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // 완료 또는 오류면 폴링 중지
      if (status === 'done' || status === 'error') return false
      return 2_000
    },
    staleTime: 0,
  })
}
