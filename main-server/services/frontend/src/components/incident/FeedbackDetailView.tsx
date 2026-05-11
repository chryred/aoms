import { useState } from 'react'
import { FileText, Pencil, Database, X, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { incidentsApi } from '@/api/incidents'
import { formatKST } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import type { Feedback, FeedbackStatus } from '@/types/feedback'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

function isImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.includes(ext)
}

function attachmentUrl(filePath: string): string {
  return `/api/v1/feedback/attachments/${filePath}`
}

function statusBadgeVariant(status: FeedbackStatus): 'warning' | 'normal' | 'critical' {
  if (status === 'approved') return 'normal'
  if (status === 'rejected') return 'critical'
  return 'warning'
}

function statusLabel(status: FeedbackStatus): string {
  if (status === 'approved') return '승인됨'
  if (status === 'rejected') return '반려됨'
  return '승인 대기'
}

interface FeedbackDetailViewProps {
  feedback: Feedback
  onResubmit?: () => void
}

export function FeedbackDetailView({ feedback, onResubmit }: FeedbackDetailViewProps) {
  const user = useAuthStore((s) => s.user)
  const isResolver = user?.name === feedback.resolver
  const isAdmin = user?.role === 'admin'
  const [showPostmortem, setShowPostmortem] = useState(false)
  // 등록자(resolver) 본인 또는 admin은 어느 상태에서든 수정 가능
  // - pending: 승인 처리 전 보강 (revision_count+1, 승인자 재알림)
  // - rejected: 반려 후 수정 → 재등록
  // - approved: 이미 승인된 항목 수정 → status=pending 복귀, 재승인 필요
  const canEdit = !!onResubmit && (isResolver || isAdmin)
  const editLabel = feedback.status === 'rejected' ? '수정 후 재등록' : '수정'

  const failedAttachments = feedback.attachments.filter((a) => a.ocr_status === 'failed')
  const processingAttachments = feedback.attachments.filter((a) => a.ocr_status === 'processing')
  const canRetryOcr = isAdmin || isResolver

  const queryClient = useQueryClient()
  const retryMutation = useMutation({
    mutationFn: () => incidentsApi.retryFeedbackOcr(feedback.incident_id, feedback.id),
    onSuccess: (data) => {
      toast.success(data.message)
      queryClient.invalidateQueries({ queryKey: ['incident-feedback', feedback.incident_id] })
    },
    onError: () => toast.error('OCR 재시도 요청에 실패했습니다.'),
  })

  return (
    <div className="space-y-3">
      {/* OCR 실패 경고 — 사용자가 첨부 재등록 결정에 필요한 정보 */}
      {failedAttachments.length > 0 && (
        <div
          role="alert"
          className="border-critical/30 bg-critical/5 flex items-start gap-2 rounded-sm border p-3"
        >
          <AlertTriangle aria-hidden="true" className="text-critical mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-text-primary min-w-0 flex-1 text-sm">
            <p className="text-critical mb-1 font-semibold">
              첨부 OCR 실패 ({failedAttachments.length}건)
            </p>
            <p className="text-text-secondary text-xs leading-relaxed">
              일부 첨부의 텍스트 추출에 실패했습니다. 해당 첨부는 검색 색인에 포함되지 않으니 OCR
              재시도하거나 파일을 교체하여 재등록해 주세요.
            </p>
            {canRetryOcr && (
              <NeuButton
                variant="ghost"
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                className="mt-2"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-3 w-3 ${retryMutation.isPending ? 'animate-spin' : ''}`}
                />
                {retryMutation.isPending ? 'OCR 재시도 요청 중...' : 'OCR 재시도'}
              </NeuButton>
            )}
          </div>
        </div>
      )}

      {/* OCR 처리 중 안내 — 승인 시 425 발생 가능 */}
      {failedAttachments.length === 0 && processingAttachments.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="border-warning/30 bg-warning/5 flex items-start gap-2 rounded-sm border p-3"
        >
          <Loader2
            aria-hidden="true"
            className="text-warning mt-0.5 h-4 w-4 shrink-0 animate-spin"
          />
          <div className="min-w-0 flex-1">
            <p className="text-text-secondary text-xs leading-relaxed">
              첨부 OCR 처리 중입니다 ({processingAttachments.length}건). 잠시 후 다시 확인해 주세요.
            </p>
            {canRetryOcr && (
              <NeuButton
                variant="ghost"
                size="sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
                className="mt-2"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`h-3 w-3 ${retryMutation.isPending ? 'animate-spin' : ''}`}
                />
                {retryMutation.isPending ? 'OCR 재시도 요청 중...' : 'OCR 재시도'}
              </NeuButton>
            )}
          </div>
        </div>
      )}

      {/* 상태 + 기본 메타 */}
      <div className="flex flex-wrap items-center gap-2">
        <NeuBadge variant={statusBadgeVariant(feedback.status)}>
          {statusLabel(feedback.status)}
        </NeuBadge>
        <NeuBadge variant="info">{feedback.error_type}</NeuBadge>
        <span className="text-text-secondary text-xs">
          {feedback.resolver} · {formatKST(feedback.created_at)}
        </span>
        {feedback.revision_count > 0 && (
          <span
            className={
              feedback.revision_count >= 5
                ? 'text-text-disabled text-xs'
                : feedback.revision_count >= 3
                  ? 'text-warning text-xs font-medium'
                  : 'text-text-disabled text-xs'
            }
          >
            재등록 {feedback.revision_count}회
            {feedback.revision_count >= 5 && ' (한도 초과)'}
          </span>
        )}
      </div>

      {/* 해결 내용 */}
      <div className="bg-bg-base shadow-neu-inset rounded-sm p-4">
        <p className="text-text-primary text-sm leading-relaxed break-words whitespace-pre-wrap">
          {feedback.solution}
        </p>
      </div>

      {/* 승인 정보 + Vector 자산 링크 */}
      {feedback.status === 'approved' && (
        <div className="flex flex-col gap-1">
          {feedback.approved_at && (
            <p className="text-text-secondary text-xs">
              승인 시각: {formatKST(feedback.approved_at, 'datetime')}
            </p>
          )}
          {feedback.qdrant_point_id && (
            <button
              type="button"
              onClick={() => setShowPostmortem(true)}
              className="text-accent hover:text-accent/80 focus:ring-accent inline-flex w-fit items-center gap-1 rounded-sm font-mono text-xs focus:ring-1 focus:outline-none"
            >
              <Database className="h-3 w-3" />
              point: {feedback.qdrant_point_id}
            </button>
          )}
        </div>
      )}

      {/* 반려 사유 */}
      {feedback.status === 'rejected' && feedback.rejection_reason && (
        <div className="border-critical/30 bg-critical/5 rounded-sm border p-3">
          <p className="text-critical mb-1 text-xs font-semibold">반려 사유</p>
          <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
            {feedback.rejection_reason}
          </p>
          {feedback.rejected_at && (
            <p className="text-text-disabled mt-1 text-xs">
              {formatKST(feedback.rejected_at, 'datetime')}
            </p>
          )}
        </div>
      )}

      {/* 재등록 사유 — 최신 재등록만 보존되며, 승인자 검토용 */}
      {feedback.revision_reason && feedback.revision_count > 0 && (
        <div className="border-warning/30 bg-warning/5 rounded-sm border p-3">
          <p className="text-warning mb-1 text-xs font-semibold">
            재등록 사유 (회차 {feedback.revision_count})
          </p>
          <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
            {feedback.revision_reason}
          </p>
        </div>
      )}

      {/* 첨부파일 */}
      {feedback.attachments.length > 0 && (
        <div>
          <p className="text-text-secondary mb-2 text-xs font-medium">
            첨부파일 ({feedback.attachments.length}건)
          </p>
          <ul className="flex flex-col gap-2">
            {feedback.attachments.map((att) => {
              const isImage = isImagePath(att.file_path)
              const url = attachmentUrl(att.file_path)
              const name = att.original_filename ?? att.file_path.split('/').pop() ?? '파일'
              return (
                <li
                  key={att.id}
                  className="border-border bg-bg-base flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border p-2"
                >
                  {isImage ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${name} 새 탭에서 열기`}
                    >
                      <img src={url} alt={name} className="h-10 w-10 rounded-sm object-cover" />
                    </a>
                  ) : (
                    <span className="text-text-secondary flex h-10 w-10 shrink-0 items-center justify-center">
                      <FileText className="h-5 w-5" />
                    </span>
                  )}
                  <span className="text-text-primary min-w-0 flex-1 truncate text-sm">{name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {att.ocr_status === 'failed' && (
                      <NeuBadge variant="critical">OCR 실패</NeuBadge>
                    )}
                    {att.ocr_status === 'processing' &&
                      (att.ocr_progress > 0 ? (
                        <span
                          className="flex items-center gap-1.5"
                          title={`OCR ${att.ocr_progress}%`}
                        >
                          <span className="bg-bg-base shadow-neu-inset block h-1.5 w-20 overflow-hidden rounded-sm">
                            <span
                              className="bg-accent block h-full rounded-sm transition-[width] duration-300"
                              style={{ width: `${att.ocr_progress}%` }}
                            />
                          </span>
                          <span className="text-text-secondary text-xs">{att.ocr_progress}%</span>
                        </span>
                      ) : (
                        <NeuBadge variant="warning">OCR 처리 중</NeuBadge>
                      ))}
                    <a
                      href={url}
                      download={name}
                      aria-label={`${name} 다운로드`}
                      className="text-accent hover:text-accent/80 text-xs"
                    >
                      다운로드
                    </a>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* 수정 버튼 (pending/rejected/approved 모두 가능) */}
      {canEdit && (
        <div className="flex flex-col gap-1">
          <NeuButton variant="ghost" size="sm" onClick={onResubmit}>
            <Pencil className="h-3 w-3" />
            {editLabel}
          </NeuButton>
          {feedback.status === 'approved' && (
            <p className="text-text-disabled text-xs">수정 시 다시 승인 절차를 거쳐야 합니다</p>
          )}
          {feedback.status === 'pending' && (
            <p className="text-text-disabled text-xs">수정 시 승인자에게 다시 알림이 발송됩니다</p>
          )}
        </div>
      )}

      {/* Vector 자산 모달 — point_id 클릭 시 collection + payload 표시 */}
      {showPostmortem && feedback.qdrant_point_id && (
        <PostmortemModal
          feedbackId={feedback.id}
          pointId={feedback.qdrant_point_id}
          onClose={() => setShowPostmortem(false)}
        />
      )}
    </div>
  )
}

// ── Vector 자산 모달 ──────────────────────────────────────────────────────────

interface PostmortemModalProps {
  feedbackId: number
  pointId: string
  onClose: () => void
}

function PostmortemModal({ feedbackId, pointId, onClose }: PostmortemModalProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['feedback-postmortem', feedbackId],
    queryFn: () => incidentsApi.getFeedbackPostmortem(feedbackId),
  })

  return (
    <>
      <div className="bg-overlay fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <NeuCard className="max-h-[80vh] w-full max-w-2xl overflow-auto">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-text-primary text-sm font-semibold">Vector 자산 정보</h3>
              <p className="text-text-secondary mt-1 text-xs">
                Qdrant 컬렉션에 저장된 RAG 검색 자산입니다
              </p>
            </div>
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {isLoading && <p className="text-text-secondary text-sm">불러오는 중...</p>}
          {isError && <p className="text-critical text-sm">자산 정보를 가져오지 못했습니다.</p>}
          {data && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-text-secondary text-xs">Collection</p>
                <p className="text-text-primary font-mono">{data.collection}</p>
              </div>
              <div>
                <p className="text-text-secondary text-xs">Point ID</p>
                <p className="text-text-primary font-mono break-all">{pointId}</p>
              </div>
              <div>
                <p className="text-text-secondary text-xs">Incident ID</p>
                <p className="text-text-primary">#{data.incident_id}</p>
              </div>
              <div>
                <p className="text-text-secondary mb-1 text-xs">Payload</p>
                <pre className="bg-bg-base shadow-neu-inset overflow-auto rounded-sm p-3 text-xs break-words whitespace-pre-wrap">
                  {JSON.stringify(data.payload, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <NeuButton variant="ghost" size="sm" onClick={onClose}>
              닫기
            </NeuButton>
          </div>
        </NeuCard>
      </div>
    </>
  )
}
