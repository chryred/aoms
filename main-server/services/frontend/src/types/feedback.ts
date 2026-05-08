export type FeedbackStatus = 'pending' | 'approved' | 'rejected'

export interface FeedbackAttachment {
  id: number
  file_path: string
  original_filename: string | null
  sort_order: number
  ocr_text: string | null
  ocr_status: 'pending' | 'processing' | 'done' | 'failed'
  created_at: string
}

export interface Feedback {
  id: number
  incident_id: number
  error_type: string
  solution: string
  resolver: string
  qdrant_point_id: string | null
  created_at: string
  status: FeedbackStatus
  approver_id: number | null
  approved_by: number | null
  approved_at: string | null
  rejection_reason: string | null
  rejected_at: string | null
  revision_count: number
  revision_reason: string | null
  attachments: FeedbackAttachment[]
}

export interface FeedbackCreateRequest {
  error_type: string
  solution: string
  resolver: string
  approver_contact_id: number
  attachment_paths?: string[]
  attachment_filenames?: string[]
}

export interface FeedbackResubmitRequest {
  error_type: string
  solution: string
  attachment_paths?: string[]
  attachment_filenames?: string[]
  kept_attachment_ids?: number[] // 보존할 기존 첨부 ID. undefined=모두 보존, []=모두 제거
  revision_reason?: string // 재등록 사유 (선택). approved/rejected 수정 시 승인자에게 표시.
}

export interface FeedbackRejectRequest {
  rejection_reason: string
}

export interface FeedbackUploadResponse {
  file_path: string
  original_filename: string
}

export interface ApproverContact {
  id: number
  user_id: number
  name: string
  email: string
  teams_upn: string | null
  has_webhook: boolean
}

export interface IncidentStatsOut {
  total: number
  registrable: number
  completed: number
}
