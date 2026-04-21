import { adminApi } from '@/lib/ky-client'
import type { AlertHistory } from '@/types/alert'

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

export interface IncidentUpdate {
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
  return adminApi
    .post(`api/v1/incidents/${id}/incident-report`, { timeout: 120_000 })
    .json()
}

export interface IncidentAiAnalyzeResponse {
  root_cause: string
  resolution: string
  postmortem: string
}

export async function aiAnalyzeIncident(id: number): Promise<IncidentAiAnalyzeResponse> {
  return adminApi
    .post(`api/v1/incidents/${id}/ai-analyze`, { timeout: 120_000 })
    .json()
}
