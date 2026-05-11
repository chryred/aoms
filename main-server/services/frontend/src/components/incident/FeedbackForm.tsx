import { useEffect, useRef, useState } from 'react'
import { Paperclip, X, FileText, Info, AlertTriangle, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HTTPError } from 'ky'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { useApprovers } from '@/hooks/queries/useApprovers'
import { useFeedbackUpload } from '@/hooks/mutations/useFeedbackUpload'
import { incidentsApi } from '@/api/incidents'
import { useAuthStore } from '@/store/authStore'
import type {
  Feedback,
  FeedbackUploadResponse,
  ResubmitLimitError,
  ResubmitWarning,
} from '@/types/feedback'

const ERROR_TYPES = [
  'DB 연결 오류',
  '메모리 부족',
  '디스크 부족',
  '네트워크 오류',
  '타임아웃',
  '애플리케이션 오류',
  '기타',
] as const

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
interface LocalAttachment {
  previewUrl: string | null
  originalFilename: string
  filePath: string
  mimeType: string
}

interface FeedbackFormProps {
  incidentId: number
  mode: 'create' | 'revise'
  existingFeedback?: Feedback
  onClose: () => void
  onSuccess?: () => void
}

export function FeedbackForm({
  incidentId,
  mode,
  existingFeedback,
  onClose,
  onSuccess,
}: FeedbackFormProps) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [errorType, setErrorType] = useState<string>(existingFeedback?.error_type ?? '기타')
  const [solution, setSolution] = useState(existingFeedback?.solution ?? '')
  const [approverContactId, setApproverContactId] = useState<number | null>(null)
  const [revisionReason, setRevisionReason] = useState('')
  const [attachments, setAttachments] = useState<LocalAttachment[]>([])
  const [resubmitWarning, setResubmitWarning] = useState<ResubmitWarning | null>(null)
  const [hardBlocked, setHardBlocked] = useState<ResubmitLimitError | null>(null)
  // revise 모드: 보존할 기존 첨부 ID 목록 (초기값 = 전체 ID, 사용자가 X로 제거 시 빠짐)
  const [keptAttachmentIds, setKeptAttachmentIds] = useState<number[]>(
    existingFeedback?.attachments.map((a) => a.id) ?? [],
  )
  const keptExistingAttachments = (existingFeedback?.attachments ?? []).filter((a) =>
    keptAttachmentIds.includes(a.id),
  )

  const { data: approvers = [] } = useApprovers()
  const uploadMutation = useFeedbackUpload()

  // revise 모드에서 초기화 — existingFeedback이 있을 때만
  useEffect(() => {
    if (mode === 'revise' && existingFeedback) {
      setErrorType(existingFeedback.error_type)
      setSolution(existingFeedback.solution)
      setKeptAttachmentIds(existingFeedback.attachments.map((a) => a.id))
      setRevisionReason('')
    }
  }, [mode, existingFeedback?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 재등록 사유 입력 노출 조건 — approved/rejected 상태에서만 (pending 보강은 사유 자연스럽지 않음)
  const showRevisionReason =
    mode === 'revise' &&
    (existingFeedback?.status === 'approved' || existingFeedback?.status === 'rejected')

  const createMutation = useMutation({
    mutationFn: () =>
      incidentsApi.createFeedback(incidentId, {
        error_type: errorType,
        solution: solution.trim(),
        resolver: user?.name ?? 'unknown',
        approver_contact_id: approverContactId!,
        attachment_paths: attachments.map((a) => a.filePath),
        attachment_filenames: attachments.map((a) => a.originalFilename),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident-feedback', incidentId] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      toast.success('해결책이 등록되었습니다')
      onSuccess?.()
      onClose()
    },
    onError: () => toast.error('해결책 등록 중 오류가 발생했습니다'),
  })

  const resubmitMutation = useMutation({
    mutationFn: () =>
      incidentsApi.resubmitFeedback(incidentId, existingFeedback!.id, {
        error_type: errorType,
        solution: solution.trim(),
        attachment_paths: attachments.map((a) => a.filePath),
        attachment_filenames: attachments.map((a) => a.originalFilename),
        kept_attachment_ids: keptAttachmentIds,
        revision_reason: showRevisionReason ? revisionReason.trim() || undefined : undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['incident-feedback', incidentId] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      if (data.warning) {
        // 소프트 리밋 경고 — 성공은 했으나 새 피드백 등록 권장 메시지를 표시
        setResubmitWarning(data.warning)
        onSuccess?.()
        // 폼을 닫지 않고 경고 카드만 표시 (사용자가 인지 후 직접 닫기)
      } else {
        toast.success('해결책이 수정되었습니다')
        onSuccess?.()
        onClose()
      }
    },
    onError: async (err) => {
      if (err instanceof HTTPError && err.response.status === 409) {
        try {
          const body = await err.response.json<{ detail: ResubmitLimitError }>()
          setHardBlocked(body.detail)
        } catch {
          toast.error('재등록 한도를 초과했습니다. 새 피드백을 등록해 주세요.')
        }
      } else {
        toast.error('수정 중 오류가 발생했습니다')
      }
    },
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''

    // 보존된 기존 첨부 + 신규 추가 합산하여 10건 제한
    const currentCount = keptExistingAttachments.length + attachments.length
    const remaining = 10 - currentCount
    const toUpload = files.slice(0, remaining)

    if (files.length > remaining) {
      toast.error(`최대 10건까지 첨부 가능합니다 (${remaining}건 추가 가능)`)
    }

    toUpload.forEach((file) => {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: 10MB 초과 파일은 업로드할 수 없습니다`)
        return
      }
      const isImage = IMAGE_MIME_TYPES.includes(file.type)
      const previewUrl = isImage ? URL.createObjectURL(file) : null

      uploadMutation.mutate(file, {
        onSuccess: (result: FeedbackUploadResponse) => {
          setAttachments((prev) => [
            ...prev,
            {
              previewUrl,
              originalFilename: result.original_filename,
              filePath: result.file_path,
              mimeType: file.type,
            },
          ])
        },
        onError: () => {
          if (previewUrl) URL.revokeObjectURL(previewUrl)
          toast.error(`${file.name} 업로드에 실패했습니다`)
        },
      })
    })
  }

  const handleRemove = (idx: number) => {
    setAttachments((prev) => {
      const item = prev[idx]
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const isSubmitDisabled =
    createMutation.isPending ||
    resubmitMutation.isPending ||
    uploadMutation.isPending ||
    !solution.trim() ||
    (mode === 'create' && !approverContactId)

  const handleSubmit = () => {
    if (isSubmitDisabled) return
    if (mode === 'revise') {
      resubmitMutation.mutate()
    } else {
      createMutation.mutate()
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-text-primary text-sm font-semibold">
          {mode === 'revise' ? '해결책 수정하기' : '해결책 등록'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="text-text-secondary hover:text-text-primary focus:ring-accent rounded-sm p-1 focus:ring-1 focus:outline-none"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-4">
        <NeuSelect
          id="fb-error-type"
          label="장애 유형"
          value={errorType}
          onChange={(e) => setErrorType(e.target.value)}
        >
          {ERROR_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </NeuSelect>

        <NeuTextarea
          id="fb-solution"
          label="해결 내용"
          rows={6}
          placeholder="수행한 조치 내용을 기술해 주세요..."
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          required
        />

        {showRevisionReason && (
          <NeuTextarea
            id="fb-revision-reason"
            label={`재등록 사유 (선택)${
              existingFeedback?.status === 'approved' ? ' · 재승인 필요' : ''
            }`}
            rows={3}
            placeholder={
              existingFeedback?.status === 'approved'
                ? '승인된 해결책을 수정하는 이유를 적어주세요. 승인자에게 함께 전달됩니다.'
                : '반려 사유에 어떻게 대응했는지 적어주세요. 승인자에게 함께 전달됩니다.'
            }
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
          />
        )}

        {mode === 'create' && (
          <NeuSelect
            id="fb-approver"
            label="승인자"
            value={approverContactId ?? ''}
            onChange={(e) => setApproverContactId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">승인자를 선택하세요</option>
            {approvers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.email}){!a.has_webhook ? ' · Teams 미연동' : ''}
              </option>
            ))}
          </NeuSelect>
        )}

        {/* 첨부파일 */}
        <div className="space-y-2">
          <span className="text-text-secondary text-xs font-medium">첨부파일</span>

          {mode === 'revise' && (
            <div className="border-border-brand bg-bg-base flex items-start gap-2 rounded-sm border p-2">
              <Info className="text-warning mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-text-secondary text-xs">
                기존 첨부는 X 버튼으로 제거할 수 있고 새 파일을 추가할 수 있습니다 (총 10건 제한).
              </p>
            </div>
          )}

          {/* 기존 첨부 (revise 모드) — X 버튼으로 제거 가능 */}
          {keptExistingAttachments.length > 0 && (
            <ul className="flex flex-col gap-2">
              {keptExistingAttachments.map((att) => (
                <li
                  key={`existing-${att.id}`}
                  className="border-border bg-bg-base flex items-center gap-3 rounded-sm border p-2"
                >
                  <span className="text-text-secondary flex h-9 w-9 shrink-0 items-center justify-center">
                    <FileText className="h-5 w-5" />
                  </span>
                  <span className="text-text-primary min-w-0 flex-1 truncate text-sm">
                    {att.original_filename ?? att.file_path.split('/').pop()}
                  </span>
                  <span className="text-text-disabled text-xs">기존</span>
                  <button
                    type="button"
                    aria-label={`${att.original_filename ?? '기존 첨부'} 제거`}
                    onClick={() =>
                      setKeptAttachmentIds((prev) => prev.filter((id) => id !== att.id))
                    }
                    className="text-text-secondary hover:text-critical focus:ring-accent shrink-0 rounded-sm p-1 focus:ring-1 focus:outline-none"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 신규 첨부 — X 버튼으로 제거 가능 */}
          {attachments.length > 0 && (
            <ul className="flex flex-col gap-2">
              {attachments.map((att, idx) => (
                <li
                  key={`${att.filePath}-${idx}`}
                  className="border-border bg-bg-base flex items-center gap-3 rounded-sm border p-2"
                >
                  {att.previewUrl ? (
                    <img
                      src={att.previewUrl}
                      alt={att.originalFilename}
                      className="h-9 w-9 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="text-text-secondary flex h-9 w-9 shrink-0 items-center justify-center">
                      <FileText className="h-5 w-5" />
                    </span>
                  )}
                  <span className="text-text-primary min-w-0 flex-1 truncate text-sm">
                    {att.originalFilename}
                  </span>
                  <span className="text-accent text-xs">신규</span>
                  <button
                    type="button"
                    aria-label={`${att.originalFilename} 제거`}
                    onClick={() => handleRemove(idx)}
                    className="text-text-secondary hover:text-critical focus:ring-accent shrink-0 rounded-sm p-1 focus:ring-1 focus:outline-none"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.txt"
            className="sr-only"
            onChange={handleFileChange}
            disabled={
              uploadMutation.isPending || keptExistingAttachments.length + attachments.length >= 10
            }
            tabIndex={-1}
          />
          <button
            type="button"
            disabled={
              uploadMutation.isPending || keptExistingAttachments.length + attachments.length >= 10
            }
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.value = ''
                fileInputRef.current.click()
              }
            }}
            className={
              uploadMutation.isPending || keptExistingAttachments.length + attachments.length >= 10
                ? 'border-border bg-btn-secondary text-text-disabled inline-flex h-8 cursor-not-allowed items-center justify-center gap-2 rounded-sm border px-3 text-sm font-medium opacity-40'
                : 'border-border bg-btn-secondary text-text-secondary hover:text-text-primary hover:bg-hover-subtle focus:ring-accent inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-sm border px-3 text-sm font-medium transition-colors focus:ring-1 focus:outline-none'
            }
          >
            <Paperclip className="h-3.5 w-3.5" />
            {uploadMutation.isPending ? '업로드 중...' : '파일 첨부'}
          </button>
          <p className="text-text-disabled text-xs">
            이미지, PDF, Excel, Word, 텍스트 파일 지원 · 최대 10MB · 10건
          </p>
        </div>

        {/* 소프트 리밋 경고 카드 — 재등록 성공 후 표시 */}
        {resubmitWarning && (
          <div
            role="alert"
            className="border-warning/30 bg-warning/5 flex items-start gap-2 rounded-sm border p-3"
          >
            <AlertTriangle aria-hidden="true" className="text-warning mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-warning mb-1 text-xs font-semibold">
                재등록 횟수 경고 ({resubmitWarning.revision_count}/{resubmitWarning.hard_limit}회)
              </p>
              <p className="text-text-secondary text-xs leading-relaxed">
                {resubmitWarning.message}
              </p>
            </div>
            <button
              type="button"
              aria-label="경고 닫기"
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary focus:ring-accent shrink-0 rounded-sm p-1 focus:ring-1 focus:outline-none"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* 버튼 */}
        <div className="flex gap-2 pt-1">
          <NeuButton onClick={handleSubmit} disabled={isSubmitDisabled} size="sm">
            {createMutation.isPending || resubmitMutation.isPending
              ? mode === 'revise'
                ? '수정 중...'
                : '등록 중...'
              : mode === 'revise'
                ? '수정하기'
                : '등록'}
          </NeuButton>
          <NeuButton variant="ghost" size="sm" onClick={onClose}>
            취소
          </NeuButton>
        </div>
      </div>

      {/* 하드 리밋 블록 모달 — 409 Conflict */}
      {hardBlocked && (
        <>
          <div className="bg-overlay fixed inset-0 z-40" aria-hidden="true" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <NeuCard className="w-full max-w-sm">
              <div className="mb-4 flex items-start gap-3">
                <Ban aria-hidden="true" className="text-text-disabled mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="text-text-primary text-sm font-semibold">재등록 한도 초과</p>
                  <p className="text-text-secondary mt-1 text-xs leading-relaxed">
                    {hardBlocked.message}
                  </p>
                  <p className="text-text-disabled mt-2 text-xs">
                    현재 {hardBlocked.revision_count}회 / 최대 {hardBlocked.hard_limit}회
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <NeuButton variant="ghost" size="sm" onClick={() => setHardBlocked(null)}>
                  닫기
                </NeuButton>
                <NeuButton
                  size="sm"
                  onClick={() => {
                    setHardBlocked(null)
                    onClose()
                  }}
                >
                  확인
                </NeuButton>
              </div>
            </NeuCard>
          </div>
        </>
      )}
    </>
  )
}
