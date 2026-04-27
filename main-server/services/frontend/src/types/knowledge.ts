export interface OperatorNote {
  point_id: string
  question: string
  answer: string
  system_id: number
  tags: string[]
  source_reference: string | null
  created_by: string | null
  created_at: string
}

export interface FrequentQuestion {
  representative_query: string
  similar_queries: string[]
  occurrence_count: number
  avg_top1_score: number
  last_asked: string
  category?: string
}

export interface KnowledgeCorrection {
  id: number
  source_point_id: string
  source_collection: string
  question: string | null
  correct_answer: string
  user_id: number | null
  created_at: string
}

export interface KnowledgeSyncStatus {
  source: string // 'jira' | 'confluence' | 'documents'
  last_sync_at: string | null
  total_synced: number
  last_error: string | null
  updated_at: string
}

export interface UploadJob {
  job_id: string
  status: 'queued' | 'embedding' | 'done' | 'error'
  file_name: string
  point_count?: number
  error?: string
}

// 업로드된 문서 항목
export interface KnowledgeDocument {
  job_id: string
  file_name: string
  system_id: number
  tags: string[]
  status: 'queued' | 'embedding' | 'done' | 'error'
  point_count?: number
  error?: string
  created_at: string
}
