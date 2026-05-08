import { adminApi, filterParams } from '@/lib/ky-client'
import type { AlertHistory } from '@/types/alert'
import type {
  Feedback,
  FeedbackCreateRequest,
  FeedbackRejectRequest,
  FeedbackResubmitRequest,
  IncidentStatsOut,
} from '@/types/feedback'

export interface IncidentOut {
  id: number
  system_id: number | null
  title: string
  severity: string
  status: string
  detected_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  closed_at: string | null
  root_cause: string | null
  resolution: string | null
  postmortem: string | null
  alert_count: number
  recurrence_of: number | null
  mtta_minutes: number | null
  mttr_minutes: number | null
  system_display_name: string | null
  has_approved_feedback: boolean
  latest_feedback_status: string | null // pending|approved|rejected|null
  created_at: string
  updated_at: string
}

export interface IncidentTimelineItem {
  id: number
  incident_id: number
  event_type: string
  description: string | null
  actor_name: string | null
  created_at: string
}

export interface IncidentDetail extends IncidentOut {
  timeline: IncidentTimelineItem[]
  alert_history: AlertHistory[]
}

export interface IncidentCreate {
  system_id: number
  title: string
  severity: string
  notes?: string
}

export interface IncidentUpdate {
  title?: string
  severity?: string
  status?: string
  root_cause?: string
  resolution?: string
  postmortem?: string
}

export interface IncidentListParams {
  system_id?: number
  status?: string
  severity?: string
  limit?: number
  offset?: number
}

export interface IncidentFeedbackPendingOut {
  feedback_id: number
  incident_id: number
  incident_title: string
  system_display_name: string | null
  alert_count: number
  resolver: string
  approver_name: string | null
  created_at: string
  revision_count: number
  status: string
  can_approve: boolean
}

/** log-analyzer incident_postmortems 검색 결과 아이템 */
export interface IncidentPostmortemItem {
  id: string
  score: number
  payload: {
    incident_id?: number
    title?: string
    system_name?: string
    system_id?: number
    severity?: string
    root_cause?: string
    solution?: string
    alert_excerpts?: string
    tags?: string[]
    [key: string]: unknown
  }
}

export interface IncidentPostmortemSearchResponse {
  results: IncidentPostmortemItem[]
}

export async function createIncident(data: IncidentCreate): Promise<IncidentOut> {
  return adminApi.post('api/v1/incidents', { json: data }).json()
}

export async function listIncidents(params: IncidentListParams = {}): Promise<IncidentOut[]> {
  return adminApi
    .get('api/v1/incidents', { searchParams: params as Record<string, string | number> })
    .json()
}

export async function getIncident(id: number): Promise<IncidentDetail> {
  return adminApi.get(`api/v1/incidents/${id}`).json()
}

export async function updateIncident(id: number, data: IncidentUpdate): Promise<IncidentOut> {
  return adminApi.patch(`api/v1/incidents/${id}`, { json: data }).json()
}

export async function addIncidentComment(
  id: number,
  comment: string,
): Promise<IncidentTimelineItem> {
  return adminApi.post(`api/v1/incidents/${id}/comments`, { json: { comment } }).json()
}

export interface IncidentReportResponse {
  report: string
}

export async function generateIncidentReport(id: number): Promise<IncidentReportResponse> {
  return adminApi.post(`api/v1/incidents/${id}/incident-report`, { timeout: 120_000 }).json()
}

export interface IncidentAiAnalyzeResponse {
  root_cause: string
  resolution: string
  postmortem: string
}

export async function aiAnalyzeIncident(id: number): Promise<IncidentAiAnalyzeResponse> {
  return adminApi.post(`api/v1/incidents/${id}/ai-analyze`, { timeout: 120_000 }).json()
}

// ── 인시던트 단위 피드백 API ────────────────────────────────────────────────

export const incidentsApi = {
  // ── 피드백 등록 ──────────────────────────────────────────────────────────
  createFeedback: (incident_id: number, body: FeedbackCreateRequest): Promise<Feedback> =>
    adminApi.post(`api/v1/incidents/${incident_id}/feedback`, { json: body }).json<Feedback>(),

  // ── 피드백 승인 (admin 또는 지정 승인자) ────────────────────────────────
  approveFeedback: (incident_id: number, feedback_id: number): Promise<Feedback> =>
    adminApi
      .post(`api/v1/incidents/${incident_id}/feedback/${feedback_id}/approve`)
      .json<Feedback>(),

  // ── 피드백 반려 ──────────────────────────────────────────────────────────
  rejectFeedback: (
    incident_id: number,
    feedback_id: number,
    body: FeedbackRejectRequest,
  ): Promise<Feedback> =>
    adminApi
      .post(`api/v1/incidents/${incident_id}/feedback/${feedback_id}/reject`, { json: body })
      .json<Feedback>(),

  // ── 피드백 재등록 ────────────────────────────────────────────────────────
  resubmitFeedback: (
    incident_id: number,
    feedback_id: number,
    body: FeedbackResubmitRequest,
  ): Promise<Feedback> =>
    adminApi
      .post(`api/v1/incidents/${incident_id}/feedback/${feedback_id}/resubmit`, { json: body })
      .json<Feedback>(),

  // ── 인시던트의 피드백 이력 ───────────────────────────────────────────────
  listFeedback: (incident_id: number, status?: string): Promise<Feedback[]> =>
    adminApi
      .get(`api/v1/incidents/${incident_id}/feedback`, {
        searchParams: filterParams(status ? { status } : {}),
      })
      .json<Feedback[]>(),

  // ── 첨부 OCR 재시도 (admin 또는 resolver 본인) ───────────────────────────
  retryFeedbackOcr: (
    incident_id: number,
    feedback_id: number,
  ): Promise<{ retried: number; message: string }> =>
    adminApi
      .post(`api/v1/incidents/${incident_id}/feedback/${feedback_id}/retry-ocr`)
      .json<{ retried: number; message: string }>(),

  // ── 피드백 단건 조회 (review/revise 페이지용 — feedback.incident_id 포함) ─
  getFeedback: (feedback_id: number): Promise<Feedback> =>
    adminApi.get(`api/v1/incidents/feedback/${feedback_id}`).json<Feedback>(),

  // ── 피드백 vector asset (incident_postmortems) 조회 ─────────────────────
  getFeedbackPostmortem: (
    feedback_id: number,
  ): Promise<{
    collection: string
    point_id: string
    incident_id: number
    payload: Record<string, unknown>
  }> => adminApi.get(`api/v1/incidents/feedback/${feedback_id}/postmortem`).json(),

  // ── admin pending 목록 ───────────────────────────────────────────────────
  pendingFeedback: (params?: {
    limit?: number
    offset?: number
  }): Promise<IncidentFeedbackPendingOut[]> =>
    adminApi
      .get('api/v1/incidents/feedback/pending', {
        searchParams: filterParams(params ?? {}),
      })
      .json<IncidentFeedbackPendingOut[]>(),

  // ── 해결책 Qdrant Hybrid 검색 ────────────────────────────────────────────
  searchPostmortem: (params: {
    query: string
    system_id?: number
    severity?: string
    limit?: number
  }): Promise<IncidentPostmortemSearchResponse> =>
    adminApi
      .get('api/v1/incidents/feedback/search', {
        searchParams: filterParams({
          query: params.query,
          system_id: params.system_id,
          severity: params.severity,
          limit: params.limit,
        }),
      })
      .json(),

  // ── 인시던트 통계 3카드 ─────────────────────────────────────────────────
  stats: (params?: { period_from?: string; period_to?: string }): Promise<IncidentStatsOut> =>
    adminApi
      .get('api/v1/incidents/stats', {
        searchParams: filterParams(params ?? {}),
      })
      .json<IncidentStatsOut>(),
}
