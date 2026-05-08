import { adminApi } from '@/lib/ky-client'
import type { FeedbackUploadResponse, ApproverContact } from '@/types/feedback'

export const feedbacksApi = {
  // ── 파일 업로드 (multipart/form-data) ─────────────────────────
  upload: (file: File): Promise<FeedbackUploadResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    return adminApi
      .post('api/v1/feedback/upload', { body: formData, timeout: 60_000 })
      .json<FeedbackUploadResponse>()
  },

  // ── 승인자 목록 ───────────────────────────────────────────────
  approvers: (): Promise<ApproverContact[]> =>
    adminApi.get('api/v1/contacts/approvers').json<ApproverContact[]>(),
}
