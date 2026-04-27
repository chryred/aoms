import { adminApi, filterParams } from '@/lib/ky-client'
import type {
  FrequentQuestion,
  KnowledgeCorrection,
  KnowledgeSyncStatus,
  OperatorNote,
  UploadJob,
} from '@/types/knowledge'

export interface OperatorNoteCreateBody {
  question: string
  answer: string
  system_id: number
  tags?: string[]
  source_reference?: string | null
}

export interface OperatorNoteUpdateBody {
  question?: string
  answer?: string
  system_id?: number
  tags?: string[]
  source_reference?: string | null
}

export interface OperatorNoteListParams {
  system_id?: number
  tag?: string
  limit?: number
  offset?: number
}

export interface FeedbackListParams {
  system_id?: number
  q?: string
  limit?: number
  offset?: number
}

export interface OperatorNoteListResult {
  items: OperatorNote[]
  total: number
}

export interface FeedbackListResult {
  items: KnowledgeCorrection[]
  total: number
}

export const knowledgeApi = {
  // ── 문서 업로드 ──────────────────────────────────────────────
  uploadDocument: (file: File, systemId: number, tags?: string[]): Promise<UploadJob> => {
    const form = new FormData()
    form.append('file', file)
    form.append('system_id', String(systemId))
    if (tags && tags.length > 0) form.append('tags', JSON.stringify(tags))
    return adminApi
      .post('api/v1/knowledge/documents', { body: form, timeout: 60_000 })
      .json<UploadJob>()
  },

  getUploadStatus: (jobId: string): Promise<UploadJob> =>
    adminApi.get(`api/v1/knowledge/documents/${jobId}`).json<UploadJob>(),

  // ── 운영자 노트 ───────────────────────────────────────────────
  createOperatorNote: (body: OperatorNoteCreateBody): Promise<OperatorNote> =>
    adminApi.post('api/v1/knowledge/notes', { json: body }).json<OperatorNote>(),

  updateOperatorNote: (pointId: string, body: OperatorNoteUpdateBody): Promise<OperatorNote> =>
    adminApi.patch(`api/v1/knowledge/notes/${pointId}`, { json: body }).json<OperatorNote>(),

  deleteOperatorNote: (pointId: string): Promise<void> =>
    adminApi.delete(`api/v1/knowledge/notes/${pointId}`).then(() => undefined),

  listOperatorNotes: (params?: OperatorNoteListParams): Promise<OperatorNoteListResult> =>
    adminApi
      .get('api/v1/knowledge/notes', { searchParams: filterParams(params ?? {}) })
      .json<OperatorNoteListResult>(),

  // ── 피드백 / 교정 이력 ────────────────────────────────────────
  listFeedback: (params?: FeedbackListParams): Promise<FeedbackListResult> =>
    adminApi
      .get('api/v1/knowledge/corrections', { searchParams: filterParams(params ?? {}) })
      .json<FeedbackListResult>(),

  // ── 자주 묻는 질문 ────────────────────────────────────────────
  listFrequentQuestions: (days: number, threshold: number): Promise<FrequentQuestion[]> =>
    adminApi
      .get('api/v1/knowledge/frequent-questions', {
        searchParams: filterParams({ days, threshold }),
      })
      .json<FrequentQuestion[]>(),

  // ── 동기화 상태 ───────────────────────────────────────────────
  getSyncStatus: (source?: string): Promise<KnowledgeSyncStatus[]> =>
    adminApi
      .get('api/v1/knowledge/sync/status', {
        searchParams: filterParams(source ? { source } : {}),
      })
      .json<KnowledgeSyncStatus[]>(),

  triggerSync: (source: 'jira' | 'confluence'): Promise<{ queued: boolean }> =>
    adminApi.post(`api/v1/knowledge/sync/${source}`).json<{ queued: boolean }>(),
}
