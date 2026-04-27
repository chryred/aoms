import { useMutation, useQueryClient } from '@tanstack/react-query'
import { knowledgeApi } from '@/api/knowledge'
import { qk } from '@/constants/queryKeys'
import type { OperatorNoteCreateBody, OperatorNoteUpdateBody } from '@/api/knowledge'

export function useUploadDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, systemId, tags }: { file: File; systemId: number; tags?: string[] }) =>
      knowledgeApi.uploadDocument(file, systemId, tags),
    onSuccess: () => {
      // 업로드 후 동기화 상태도 갱신
      qc.invalidateQueries({ queryKey: qk.knowledge.syncStatus() })
    },
  })
}

export function useCreateOperatorNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: OperatorNoteCreateBody) => knowledgeApi.createOperatorNote(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', 'notes'] })
    },
  })
}

export function useUpdateOperatorNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pointId, body }: { pointId: string; body: OperatorNoteUpdateBody }) =>
      knowledgeApi.updateOperatorNote(pointId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', 'notes'] })
    },
  })
}

export function useDeleteOperatorNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pointId: string) => knowledgeApi.deleteOperatorNote(pointId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', 'notes'] })
    },
  })
}

export function useTriggerSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (source: 'jira' | 'confluence') => knowledgeApi.triggerSync(source),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', 'sync-status'] })
    },
  })
}
