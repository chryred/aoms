import { adminApi, filterParams } from '@/lib/ky-client'
import type { KnowledgeDocumentListResponse } from '@/types/knowledge-verify'

export interface ListKnowledgeDocumentsParams {
  system_id?: number
}

export interface DeleteDocumentResult {
  deleted_points: number
  deleted_file: boolean
}

export const knowledgeDocumentsApi = {
  /** file_hash 기반 적재 문서 목록 조회 */
  listDocuments: (params?: ListKnowledgeDocumentsParams): Promise<KnowledgeDocumentListResponse> =>
    adminApi
      .get('api/v1/knowledge/documents', { searchParams: filterParams(params ?? {}) })
      .json<KnowledgeDocumentListResponse>(),

  /** file_hash 기반 문서 청크 일괄 삭제 */
  deleteDocument: (fileHash: string): Promise<DeleteDocumentResult> =>
    adminApi.delete(`api/v1/knowledge/documents/${fileHash}`).json<DeleteDocumentResult>(),
}
