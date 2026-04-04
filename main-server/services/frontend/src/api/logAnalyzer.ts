import ky from 'ky'
import { useAuthStore } from '@/store/authStore'
import type {
  SimilarSearchRequest,
  SimilarSearchResponse,
  CollectionsInfo,
  AggregationStatusResponse,
} from '@/types/search'

// Vite proxy: /aggregation → log-analyzer:8000
const logAnalyzerKy = ky.create({
  prefixUrl: '/aggregation',
  timeout: 15_000,
  credentials: 'include',
  hooks: {
    beforeRequest: [
      (request) => {
        const token = useAuthStore.getState().token
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
  },
})

export const logAnalyzerSearchApi = {
  /**
   * POST /aggregation/search
   * 자연어 쿼리를 Qdrant에서 유사 집계 기간으로 검색.
   */
  similarSearch: (body: SimilarSearchRequest): Promise<SimilarSearchResponse> =>
    logAnalyzerKy.post('search', { json: body }).json<SimilarSearchResponse>(),

  /**
   * GET /aggregation/collections/info
   * metric_hourly_patterns, aggregation_summaries 컬렉션 상태 확인.
   */
  getCollectionInfo: (): Promise<CollectionsInfo> =>
    logAnalyzerKy.get('collections/info').json<CollectionsInfo>(),

  /**
   * GET /aggregation/status
   * WF6~WF11 집계 파이프라인 실행 상태 조회.
   */
  getAggregationStatus: (): Promise<AggregationStatusResponse> =>
    logAnalyzerKy.get('status').json<AggregationStatusResponse>(),
}
