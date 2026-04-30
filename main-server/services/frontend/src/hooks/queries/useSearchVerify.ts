import { useMutation } from '@tanstack/react-query'
import { knowledgeVerifyApi } from '@/api/knowledge-verify'
import type { SearchVerifyChatbotBody, SearchVerifyCollectionsBody } from '@/api/knowledge-verify'

/** 챗봇 시뮬레이션 모드 검색 — 버튼 클릭 트리거 */
export function useSearchVerifyChatbot() {
  return useMutation({
    mutationFn: (body: SearchVerifyChatbotBody) => knowledgeVerifyApi.searchChatbot(body),
  })
}

/** 컬렉션 직접 검색 모드 — 버튼 클릭 트리거 */
export function useSearchVerifyCollections() {
  return useMutation({
    mutationFn: (body: SearchVerifyCollectionsBody) => knowledgeVerifyApi.searchCollections(body),
  })
}
