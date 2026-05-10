// 검색 검증 탭 타입 정의

export type SearchVerifyMode = 'chatbot' | 'collections'

export type RagCollection =
  | 'log_incidents'
  | 'metric_baselines'
  | 'aggregation_summaries'
  | 'metric_hourly_patterns'
  | 'incident_postmortems'
  | 'knowledge_jira_issues'
  | 'knowledge_confluence_pages'
  | 'knowledge_documents'

export const ALL_COLLECTIONS: RagCollection[] = [
  'log_incidents',
  'metric_baselines',
  'aggregation_summaries',
  'metric_hourly_patterns',
  'incident_postmortems',
  'knowledge_jira_issues',
  'knowledge_confluence_pages',
  'knowledge_documents',
]

export const COLLECTION_LABELS: Record<RagCollection, string> = {
  log_incidents: 'log_incidents',
  metric_baselines: 'metric_baselines',
  aggregation_summaries: 'aggregation_summaries',
  metric_hourly_patterns: 'metric_hourly_patterns',
  incident_postmortems: 'incident_postmortems',
  knowledge_jira_issues: 'knowledge_jira_issues',
  knowledge_confluence_pages: 'knowledge_confluence_pages',
  knowledge_documents: 'knowledge_documents',
}

export const KNOWLEDGE_COLLECTIONS: RagCollection[] = [
  'knowledge_jira_issues',
  'knowledge_confluence_pages',
  'knowledge_documents',
]

/** 검색 결과 아이템 — admin-api /api/v1/knowledge/search-verify/* 응답 */
export interface SearchVerifyResult {
  collection: string
  score: number
  point_id?: string
  // 운영자 노트 필드
  question?: string
  answer?: string
  // 문서 청크 필드
  file_name?: string
  file_hash?: string
  chunk_index?: number
  page_number?: number
  slide_number?: number
  // 로그/메트릭 이력 필드
  system_id?: number
  system_name?: string
  resolved_at?: string
  resolved_by?: string
  solution?: string
  // Jira/Confluence 필드
  issue_key?: string
  issue_url?: string
  page_title?: string
  page_url?: string
  // 공통 본문
  content?: string
  created_at?: string
  // 챗봇 모드 출처 도구
  tool?: string
  // incident_postmortems 전용 필드 (Wave 3C)
  incident_id?: number
  title?: string
  root_cause?: string
  alert_excerpts?: string
  tags?: string[]
  // 기타 메타데이터 (백엔드 응답 형식이 확정되면 축소 가능)
  [key: string]: unknown
}

/** 컬렉션별 결과 그룹 — admin-api /api/v1/knowledge/search-verify/* v2 응답 */
export interface CollectionGroup {
  collection: string
  tool: string
  reranked: boolean
  results: SearchVerifyResult[]
}

/** 도구별 부분 실패 오류 */
export interface ToolError {
  tool: string
  collection: string
  reason: string
}

export interface SearchVerifyResponse {
  groups: CollectionGroup[]
  used_tools?: string[]
  errors?: ToolError[]
}

/** file_hash 기반 문서 목록 아이템 (upload job 기반 KnowledgeDocument와 다름) */
export interface KnowledgeDocumentItem {
  file_hash: string
  file_name: string
  system_id: number
  chunk_count: number
  uploaded_at: string
  point_ids?: string[]
}

export interface DocumentChunk {
  point_id: string
  chunk_index: number
  text: string
  stored_at?: string
  page_no?: number
  sheet_name?: string
  slide_no?: number
  slide_title?: string
  heading?: string
  tags?: string[]
  doc_type?: string
}

export interface DocumentChunksResponse {
  chunks: DocumentChunk[]
}

export interface KnowledgeDocumentListResponse {
  items: KnowledgeDocumentItem[]
}

/** 결과 카드 종류 판별 */
export type CardKind =
  | 'operator_note'
  | 'document_chunk'
  | 'jira_confluence'
  | 'incident_postmortem'
  | 'incident_metric'

/**
 * 결과 항목의 컬렉션 + doc_type 을 함께 보고 카드 종류를 결정한다.
 * - 운영자 노트는 `knowledge_documents` 컬렉션에 `doc_type=operator_note` 로 저장되므로
 *   collection 만으로는 일반 문서 청크와 구분할 수 없다.
 * - `incident_postmortems`: Wave 3C 신규 — 인시던트 사후분석 서사
 */
export function getCardKind(
  result: Pick<SearchVerifyResult, 'collection'> & { doc_type?: unknown },
): CardKind {
  const collection = result.collection
  if (collection === 'incident_postmortems') {
    return 'incident_postmortem'
  }
  if (collection === 'knowledge_documents') {
    return result.doc_type === 'operator_note' ? 'operator_note' : 'document_chunk'
  }
  if (collection === 'knowledge_jira_issues' || collection === 'knowledge_confluence_pages') {
    return 'jira_confluence'
  }
  // log_incidents, metric_baselines, aggregation_summaries, metric_hourly_patterns
  return 'incident_metric'
}
