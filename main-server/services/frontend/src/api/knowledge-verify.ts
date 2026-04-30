import { adminApi } from '@/lib/ky-client'
import type { SearchVerifyResponse } from '@/types/knowledge-verify'

export interface SearchVerifyChatbotBody {
  query: string
  system_ids: number[]
}

export interface SearchVerifyCollectionsBody {
  query: string
  system_ids: number[]
  collections: string[]
  use_reranker: boolean
}

export const knowledgeVerifyApi = {
  /** 챗봇 시뮬레이션 모드 — 3개 RAG 도구 동일 로직 통합 결과 */
  searchChatbot: (body: SearchVerifyChatbotBody): Promise<SearchVerifyResponse> =>
    adminApi
      .post('api/v1/knowledge/search-verify/chatbot', { json: body })
      .json<SearchVerifyResponse>(),

  /** 컬렉션 직접 검색 모드 — 선택 컬렉션, Reranker 토글 지원 */
  searchCollections: (body: SearchVerifyCollectionsBody): Promise<SearchVerifyResponse> =>
    adminApi
      .post('api/v1/knowledge/search-verify/collections', { json: body })
      .json<SearchVerifyResponse>(),
}
