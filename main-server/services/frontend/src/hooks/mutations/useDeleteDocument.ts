import { useMutation, useQueryClient } from '@tanstack/react-query'
import { knowledgeDocumentsApi } from '@/api/knowledge-documents'

export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fileHash: string) => knowledgeDocumentsApi.deleteDocument(fileHash),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', 'documents', 'list'] })
    },
  })
}
