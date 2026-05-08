import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, ClipboardCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { EmptyState } from '@/components/common/EmptyState'
import { incidentsApi, type IncidentFeedbackPendingOut } from '@/api/incidents'
import { formatKST } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { FeedbackStatus } from '@/types/feedback'
import { ROUTES } from '@/constants/routes'

const PAGE_SIZE = 20

function StatusBadge({ status }: { status: FeedbackStatus | string }) {
  if (status === 'pending') {
    return <NeuBadge variant="warning">대기</NeuBadge>
  }
  if (status === 'rejected') {
    return <NeuBadge variant="critical">반려</NeuBadge>
  }
  return <NeuBadge variant="normal">승인</NeuBadge>
}

interface RejectModalProps {
  open: boolean
  isPending: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
}

function RejectModal({ open, isPending, onConfirm, onCancel }: RejectModalProps) {
  const [reason, setReason] = useState('')

  if (!open) return null

  const handleConfirm = () => {
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error('반려 사유를 입력해 주세요.')
      return
    }
    onConfirm(trimmed)
  }

  return (
    <>
      {/* Overlay */}
      <div className="bg-overlay fixed inset-0 z-40" onClick={onCancel} aria-hidden="true" />
      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
        className="border-border bg-bg-base shadow-neu-flat fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-sm border p-6"
      >
        <h3 id="reject-modal-title" className="text-text-primary mb-4 text-sm font-semibold">
          반려 사유 입력
        </h3>
        <NeuTextarea
          label="반려 사유"
          id="reject-reason"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="반려 사유를 입력하세요..."
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <NeuButton variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
            취소
          </NeuButton>
          <NeuButton
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            disabled={isPending || !reason.trim()}
          >
            {isPending ? '처리 중...' : '반려'}
          </NeuButton>
        </div>
      </div>
    </>
  )
}

export function FeedbackPendingList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [rejectTarget, setRejectTarget] = useState<{
    incidentId: number
    feedbackId: number
  } | null>(null)

  const limit = PAGE_SIZE

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['incident-feedback-pending', limit, offset],
    queryFn: () => incidentsApi.pendingFeedback({ limit, offset }),
  })

  const items: IncidentFeedbackPendingOut[] = data ?? []
  const hasPrev = offset > 0
  const hasNext = items.length >= limit
  const currentPage = Math.floor(offset / limit) + 1

  const approveMutation = useMutation({
    mutationFn: ({ incidentId, feedbackId }: { incidentId: number; feedbackId: number }) =>
      incidentsApi.approveFeedback(incidentId, feedbackId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      toast.success('해결책이 승인되었습니다.')
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 425) {
        toast.error('OCR 처리 중입니다. 잠시 후 다시 시도해 주세요.')
      } else {
        toast.error('승인 처리 중 오류가 발생했습니다.')
      }
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({
      incidentId,
      feedbackId,
      rejection_reason,
    }: {
      incidentId: number
      feedbackId: number
      rejection_reason: string
    }) => incidentsApi.rejectFeedback(incidentId, feedbackId, { rejection_reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      setRejectTarget(null)
      toast.success('해결책이 반려되었습니다.')
    },
    onError: () => {
      toast.error('반려 처리 중 오류가 발생했습니다.')
    },
  })

  const handleRowClick = (incidentId: number) => {
    navigate(ROUTES.incidentDetail(incidentId))
  }

  const handleApprove = (e: React.MouseEvent, item: IncidentFeedbackPendingOut) => {
    e.stopPropagation()
    approveMutation.mutate({ incidentId: item.incident_id, feedbackId: item.feedback_id })
  }

  const handleRejectOpen = (e: React.MouseEvent, item: IncidentFeedbackPendingOut) => {
    e.stopPropagation()
    setRejectTarget({ incidentId: item.incident_id, feedbackId: item.feedback_id })
  }

  const handleRejectConfirm = (reason: string) => {
    if (!rejectTarget) return
    rejectMutation.mutate({
      incidentId: rejectTarget.incidentId,
      feedbackId: rejectTarget.feedbackId,
      rejection_reason: reason,
    })
  }

  return (
    <div className="space-y-4">
      {/* 헤더 액션 */}
      <div className="flex items-center justify-end">
        <NeuButton variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4" />
          새로고침
        </NeuButton>
      </div>

      {isLoading && <LoadingSkeleton shape="table" count={6} />}
      {isError && <ErrorCard onRetry={() => refetch()} />}

      {!isLoading && !isError && items.length === 0 && (
        <NeuCard className="py-16">
          <EmptyState
            icon={<ClipboardCheck className="text-text-secondary h-10 w-10" />}
            title="현재 승인 대기 중인 해결책이 없습니다"
            description="새로운 해결책이 등록되면 여기에 표시됩니다."
          />
        </NeuCard>
      )}

      {!isLoading && !isError && items.length > 0 && (
        <NeuCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-border text-text-primary border-b text-left text-xs font-semibold tracking-wider uppercase">
                <tr>
                  <th className="px-3 py-2.5 whitespace-nowrap">시스템</th>
                  <th className="px-3 py-2.5">인시던트 제목</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">알림 수</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">등록자</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">지정 승인자</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">등록 시각</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">재등록</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">상태</th>
                  <th className="px-3 py-2.5 whitespace-nowrap">처리</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.feedback_id}
                    className="border-border text-text-primary hover:bg-hover-subtle cursor-pointer border-b transition-colors last:border-b-0"
                    onClick={() => handleRowClick(item.incident_id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleRowClick(item.incident_id)
                      }
                    }}
                    role="button"
                    aria-label={`인시던트 ${item.incident_title} 보기`}
                  >
                    <td className="text-text-secondary px-3 py-2.5 text-xs whitespace-nowrap">
                      {item.system_display_name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="block max-w-[200px] truncate text-xs"
                        title={item.incident_title}
                      >
                        {item.incident_title}
                      </span>
                    </td>
                    <td className="text-text-secondary px-3 py-2.5 text-xs whitespace-nowrap">
                      {item.alert_count}건
                    </td>
                    <td className="text-text-secondary px-3 py-2.5 text-xs whitespace-nowrap">
                      {item.resolver || '—'}
                    </td>
                    <td className="text-text-secondary px-3 py-2.5 text-xs whitespace-nowrap">
                      {item.approver_name ?? '—'}
                    </td>
                    <td className="text-text-secondary px-3 py-2.5 text-xs whitespace-nowrap">
                      {formatKST(item.created_at, 'datetime')}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {item.revision_count > 0 ? (
                        <NeuBadge variant="warning">재등록 {item.revision_count}회</NeuBadge>
                      ) : (
                        <span className="text-text-disabled text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {item.can_approve ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => handleApprove(e, item)}
                              disabled={approveMutation.isPending}
                              className={cn(
                                'text-normal focus:ring-accent rounded-sm px-2 py-0.5 text-xs font-medium',
                                'hover:bg-hover-subtle focus:ring-1 focus:outline-none',
                                'disabled:cursor-not-allowed disabled:opacity-40',
                              )}
                            >
                              승인
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleRejectOpen(e, item)}
                              disabled={rejectMutation.isPending}
                              className={cn(
                                'text-critical focus:ring-accent rounded-sm px-2 py-0.5 text-xs font-medium',
                                'hover:bg-hover-subtle focus:ring-1 focus:outline-none',
                                'disabled:cursor-not-allowed disabled:opacity-40',
                              )}
                            >
                              반려
                            </button>
                          </>
                        ) : (
                          <span
                            className="text-text-disabled cursor-default text-xs"
                            title={`관리자 또는 지정 승인자만 처리할 수 있습니다 (지정자: ${item.approver_name ?? '미지정'})`}
                          >
                            —
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NeuCard>
      )}

      {!isLoading && !isError && (hasPrev || hasNext) && (
        <div className="flex items-center justify-between">
          <span className="text-text-secondary text-sm">페이지 {currentPage}</span>
          <div className="flex gap-2">
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              이전
            </NeuButton>
            <NeuButton
              variant="ghost"
              size="sm"
              disabled={!hasNext}
              onClick={() => setOffset(offset + limit)}
            >
              다음
            </NeuButton>
          </div>
        </div>
      )}

      <RejectModal
        open={rejectTarget !== null}
        isPending={rejectMutation.isPending}
        onConfirm={handleRejectConfirm}
        onCancel={() => setRejectTarget(null)}
      />
    </div>
  )
}
