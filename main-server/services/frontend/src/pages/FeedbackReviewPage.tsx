import { useState } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, AlertTriangle, FileText, CheckCheck, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { incidentsApi } from '@/api/incidents'
import { useAuthStore } from '@/store/authStore'
import { ROUTES } from '@/constants/routes'
import { formatKST, formatRelative } from '@/lib/utils'
import type { FeedbackStatus } from '@/types/feedback'

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

export function FeedbackReviewPage() {
  const { feedbackId } = useParams<{ feedbackId: string }>()
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()

  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const id = Number(feedbackId)
  const validId = Boolean(feedbackId) && !Number.isNaN(id) && id > 0

  // 모든 훅은 조건부 return 이전에 호출 (rules-of-hooks)
  const {
    data: feedback,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['feedback', id],
    queryFn: () => incidentsApi.getFeedback(id),
    enabled: validId,
  })

  const approveMutation = useMutation({
    mutationFn: () => {
      if (!feedback) throw new Error('feedback not loaded')
      return incidentsApi.approveFeedback(feedback.incident_id, id)
    },
    onSuccess: () => {
      toast.success('해결책이 승인되었습니다.')
      queryClient.invalidateQueries({ queryKey: ['feedback', id] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback'] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      setTimeout(() => {
        window.close()
      }, 1000)
    },
    onError: () => toast.error('승인 처리 중 오류가 발생했습니다.'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => {
      if (!feedback) throw new Error('feedback not loaded')
      return incidentsApi.rejectFeedback(feedback.incident_id, id, {
        rejection_reason: rejectionReason.trim(),
      })
    },
    onSuccess: () => {
      toast.success('해결책이 반려 처리되었습니다.')
      queryClient.invalidateQueries({ queryKey: ['feedback', id] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback'] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      setShowRejectForm(false)
    },
    onError: () => toast.error('반려 처리 중 오류가 발생했습니다.'),
  })

  // admin 가드 — AuthGuard는 토큰만 체크하므로 여기서 role 확인
  if (!user || user.role !== 'admin') {
    return <Navigate to={ROUTES.DASHBOARD} replace />
  }

  if (!validId) {
    return (
      <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
        <NeuCard className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="text-critical h-10 w-10" />
            <h1 className="text-text-primary text-xl font-semibold">잘못된 접근입니다</h1>
            <p className="text-text-secondary text-sm">
              피드백 ID가 누락되었거나 유효하지 않습니다.
            </p>
          </div>
        </NeuCard>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
        <NeuCard className="w-full max-w-2xl">
          <p className="text-text-secondary text-sm">불러오는 중...</p>
        </NeuCard>
      </div>
    )
  }

  if (isError || !feedback) {
    return (
      <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
        <NeuCard className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="text-critical h-10 w-10" />
            <h1 className="text-text-primary text-xl font-semibold">불러오기 실패</h1>
            <p className="text-text-secondary text-sm">
              피드백 데이터를 가져오지 못했습니다. 다시 시도해 주세요.
            </p>
            <div className="mt-3 flex gap-2">
              <NeuButton size="sm" loading={isRefetching} onClick={() => refetch()}>
                재시도
              </NeuButton>
              <NeuButton variant="ghost" size="sm" onClick={() => window.close()}>
                닫기
              </NeuButton>
            </div>
          </div>
        </NeuCard>
      </div>
    )
  }

  const isPending = feedback.status === 'pending'
  const isActionsDisabled = approveMutation.isPending || rejectMutation.isPending || !isPending

  const handleReject = () => {
    if (!rejectionReason.trim()) {
      toast.error('반려 사유를 입력해 주세요.')
      return
    }
    rejectMutation.mutate()
  }

  return (
    <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
      <div className="w-full max-w-2xl space-y-4">
        {/* 헤더 */}
        <NeuCard>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-text-primary text-xl font-semibold">해결책 감리 검토</h1>
              <p className="text-text-secondary text-sm">
                등록된 해결책을 검토하고 승인 또는 반려하세요.
              </p>
            </div>
            <NeuBadge variant={statusBadgeVariant(feedback.status)}>
              {statusLabel(feedback.status)}
            </NeuBadge>
          </div>

          {/* 이미 처리된 경우 안내 */}
          {!isPending && (
            <div className="border-border bg-bg-deep mt-4 rounded-sm border p-3">
              {feedback.status === 'approved' ? (
                <div className="flex items-center gap-2">
                  <CheckCheck className="text-normal h-4 w-4 shrink-0" />
                  <p className="text-text-secondary text-sm">
                    이미 승인된 항목입니다.
                    {feedback.approved_at
                      ? ` (승인 시각: ${formatKST(feedback.approved_at, 'datetime')})`
                      : ''}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Ban className="text-critical h-4 w-4 shrink-0" />
                  <p className="text-text-secondary text-sm">
                    이미 반려된 항목입니다.
                    {feedback.rejected_at
                      ? ` (반려 시각: ${formatKST(feedback.rejected_at, 'datetime')})`
                      : ''}
                  </p>
                </div>
              )}
            </div>
          )}
        </NeuCard>

        {/* 기본 정보 */}
        <NeuCard>
          <h2 className="text-text-primary mb-3 text-sm font-semibold tracking-wide uppercase">
            기본 정보
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-text-secondary">피드백 ID</dt>
            <dd className="text-text-primary font-mono">#{feedback.id}</dd>

            <dt className="text-text-secondary">인시던트 ID</dt>
            <dd className="text-text-primary font-mono">#{feedback.incident_id}</dd>

            <dt className="text-text-secondary">장애 유형</dt>
            <dd className="text-text-primary">{feedback.error_type}</dd>

            <dt className="text-text-secondary">처리자</dt>
            <dd className="text-text-primary">{feedback.resolver}</dd>

            <dt className="text-text-secondary">등록 시각</dt>
            <dd className="text-text-primary" title={formatKST(feedback.created_at, 'datetime')}>
              {formatRelative(feedback.created_at)}
            </dd>

            {feedback.revision_count > 0 && (
              <>
                <dt className="text-text-secondary">재등록 횟수</dt>
                <dd className="text-text-primary">{feedback.revision_count}회</dd>
              </>
            )}
          </dl>
        </NeuCard>

        {/* 해결 내용 */}
        <NeuCard>
          <h2 className="text-text-primary mb-3 text-sm font-semibold tracking-wide uppercase">
            해결 내용
          </h2>
          <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
            {feedback.solution}
          </p>
        </NeuCard>

        {/* 반려 사유 (반려된 경우) */}
        {feedback.status === 'rejected' && feedback.rejection_reason && (
          <NeuCard>
            <h2 className="text-critical mb-3 text-sm font-semibold tracking-wide uppercase">
              반려 사유
            </h2>
            <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
              {feedback.rejection_reason}
            </p>
          </NeuCard>
        )}

        {/* 재등록 사유 — 등록자가 작성한 변경 의도 (최신 회차만 보존) */}
        {feedback.revision_reason && feedback.revision_count > 0 && (
          <NeuCard>
            <h2 className="text-warning mb-3 text-sm font-semibold tracking-wide uppercase">
              재등록 사유 (회차 {feedback.revision_count})
            </h2>
            <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
              {feedback.revision_reason}
            </p>
          </NeuCard>
        )}

        {/* 첨부파일 */}
        {feedback.attachments.length > 0 && (
          <NeuCard>
            <h2 className="text-text-primary mb-3 text-sm font-semibold tracking-wide uppercase">
              첨부파일 ({feedback.attachments.length}건)
            </h2>
            <ul className="flex flex-col gap-2">
              {feedback.attachments.map((att) => {
                const isImage = isImagePath(att.file_path)
                const url = attachmentUrl(att.file_path)
                const name = att.original_filename ?? att.file_path.split('/').pop() ?? '파일'
                return (
                  <li
                    key={att.id}
                    className="border-border bg-bg-deep flex items-center gap-3 rounded-sm border p-2"
                  >
                    {isImage ? (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt={name} className="h-12 w-12 rounded-sm object-cover" />
                      </a>
                    ) : (
                      <span className="text-text-secondary flex h-12 w-12 shrink-0 items-center justify-center">
                        <FileText className="h-6 w-6" />
                      </span>
                    )}
                    <span className="text-text-primary min-w-0 flex-1 truncate text-sm">
                      {name}
                    </span>
                    <a
                      href={url}
                      download={name}
                      className="text-accent hover:text-accent/80 text-xs"
                    >
                      다운로드
                    </a>
                  </li>
                )
              })}
            </ul>
          </NeuCard>
        )}

        {/* 액션 버튼 */}
        <NeuCard>
          {!showRejectForm ? (
            <div className="flex gap-3">
              <NeuButton
                onClick={() => approveMutation.mutate()}
                disabled={isActionsDisabled}
                className="flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {approveMutation.isPending ? '승인 중...' : '승인'}
              </NeuButton>
              <NeuButton
                variant="ghost"
                onClick={() => setShowRejectForm(true)}
                disabled={isActionsDisabled}
                className="flex items-center gap-2"
              >
                <XCircle className="h-4 w-4" />
                반려
              </NeuButton>
            </div>
          ) : (
            <div className="space-y-3">
              <NeuTextarea
                id="rejection-reason"
                label="반려 사유 *"
                rows={4}
                placeholder="반려 사유를 구체적으로 입력해 주세요..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
              />
              <div className="flex gap-3">
                <NeuButton
                  onClick={handleReject}
                  disabled={rejectMutation.isPending || !rejectionReason.trim()}
                  className="flex items-center gap-2"
                >
                  <XCircle className="h-4 w-4" />
                  {rejectMutation.isPending ? '처리 중...' : '반려 확인'}
                </NeuButton>
                <NeuButton
                  variant="ghost"
                  onClick={() => {
                    setShowRejectForm(false)
                    setRejectionReason('')
                  }}
                  disabled={rejectMutation.isPending}
                >
                  취소
                </NeuButton>
              </div>
            </div>
          )}
        </NeuCard>
      </div>
    </div>
  )
}

export default FeedbackReviewPage
