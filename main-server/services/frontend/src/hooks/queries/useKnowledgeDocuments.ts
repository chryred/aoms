import { useQuery } from '@tanstack/react-query'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'
import type { ListKnowledgeDocumentsParams } from '@/api/knowledge-documents'

export function useKnowledgeDocuments(params?: ListKnowledgeDocumentsParams) {
  return useQuery({
    queryKey: ['knowledge', 'documents', 'list', params],
    queryFn: () => knowledgeDocumentsApi.listDocuments(params),
    staleTime: 30_000,
  })
}
