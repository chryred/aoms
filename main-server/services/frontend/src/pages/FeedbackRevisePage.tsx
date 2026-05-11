import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Paperclip, X, FileText, Info, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { HTTPError } from 'ky'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { incidentsApi } from '@/api/incidents'
import { useFeedbackUpload } from '@/hooks/mutations/useFeedbackUpload'
import type { FeedbackUploadResponse, ResubmitLimitError } from '@/types/feedback'

const ERROR_TYPES = [
  'DB 연결 오류',
  '메모리 부족',
  '디스크 부족',
  '네트워크 오류',
  '타임아웃',
  '애플리케이션 오류',
  '기타',
] as const

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']

function isImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.includes(ext)
}

function attachmentUrl(filePath: string): string {
  return `/api/v1/feedback/attachments/${filePath}`
}

interface LocalAttachment {
  previewUrl: string | null
  originalFilename: string
  filePath: string
  mimeType: string
}

export function FeedbackRevisePage() {
  const { feedbackId } = useParams<{ feedbackId: string }>()
  const queryClient = useQueryClient()

  const id = Number(feedbackId)
  const validId = Boolean(feedbackId) && !Number.isNaN(id) && id > 0

  const [errorType, setErrorType] = useState<string>('DB 연결 오류')
  const [solution, setSolution] = useState('')
  const [revisionReason, setRevisionReason] = useState('')
  const [newAttachments, setNewAttachments] = useState<LocalAttachment[]>([])
  const [done, setDone] = useState(false)
  const [hardBlocked, setHardBlocked] = useState<ResubmitLimitError | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadMutation = useFeedbackUpload()

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

  const resubmitMutation = useMutation({
    mutationFn: () => {
      if (!feedback) throw new Error('feedback not loaded')
      return incidentsApi.resubmitFeedback(feedback.incident_id, id, {
        error_type: errorType,
        solution: solution.trim(),
        attachment_paths: newAttachments.map((a) => a.filePath),
        attachment_filenames: newAttachments.map((a) => a.originalFilename),
        revision_reason: revisionReason.trim() || undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback', id] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback'] })
      queryClient.invalidateQueries({ queryKey: ['incident-feedback-pending'] })
      toast.success('재검토 요청이 발송되었습니다.')
      setDone(true)
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
        toast.error('재등록 중 오류가 발생했습니다.')
      }
    },
  })

  // pre-fill 폼: 데이터 로드 후 1회 초기화
  useEffect(() => {
    if (feedback) {
      setErrorType(feedback.error_type)
      setSolution(feedback.solution)
    }
  }, [feedback?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''

    files.forEach((file) => {
      const isImage = IMAGE_MIME_TYPES.includes(file.type)
      const previewUrl = isImage ? URL.createObjectURL(file) : null

      uploadMutation.mutate(file, {
        onSuccess: (result: FeedbackUploadResponse) => {
          setNewAttachments((prev) => [
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
          toast.error('파일 업로드에 실패했습니다.')
        },
      })
    })
  }

  const handleRemoveNewAttachment = (idx: number) => {
    setNewAttachments((prev) => {
      const item = prev[idx]
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const isSubmitDisabled =
    resubmitMutation.isPending || uploadMutation.isPending || !solution.trim()

  // 잘못된 ID
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

  // 재등록할 수 없는 상태
  if (feedback.status !== 'rejected') {
    const stateLabel =
      feedback.status === 'approved'
        ? '이미 승인된 해결책입니다.'
        : '이미 재등록되어 검토 대기 중입니다.'

    return (
      <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
        <NeuCard className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 text-center">
            <Info className="text-accent h-10 w-10" />
            <h1 className="text-text-primary text-xl font-semibold">재등록할 수 없는 상태입니다</h1>
            <p className="text-text-secondary text-sm">{stateLabel}</p>
            <NeuBadge
              variant={feedback.status === 'approved' ? 'normal' : 'warning'}
              className="mt-1"
            >
              {feedback.status === 'approved' ? '승인됨' : '승인 대기'}
            </NeuBadge>
          </div>
        </NeuCard>
      </div>
    )
  }

  // 재등록 완료
  if (done) {
    return (
      <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
        <NeuCard className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="text-normal h-10 w-10" />
            <h1 className="text-text-primary text-xl font-semibold">
              재검토 요청이 발송되었습니다
            </h1>
            <p className="text-text-secondary text-sm">
              수정된 해결책이 제출되었습니다. 승인자의 검토를 기다려 주세요. 이 창을 닫아도 됩니다.
            </p>
            <NeuButton onClick={() => window.close()} className="mt-2">
              창 닫기
            </NeuButton>
          </div>
        </NeuCard>
      </div>
    )
  }

  return (
    <div className="bg-bg-base flex min-h-screen items-start justify-center p-6">
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
                <NeuButton size="sm" onClick={() => setHardBlocked(null)}>
                  확인
                </NeuButton>
              </div>
            </NeuCard>
          </div>
        </>
      )}
      <div className="w-full max-w-xl space-y-4">
        {/* 반려 사유 */}
        <NeuCard>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="text-critical h-4 w-4 shrink-0" />
            <h2 className="text-critical text-sm font-semibold">반려 사유</h2>
          </div>
          <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">
            {feedback.rejection_reason ?? '반려 사유가 기록되지 않았습니다.'}
          </p>
        </NeuCard>

        {/* 재등록 폼 */}
        <NeuCard>
          <h1 className="text-text-primary mb-5 text-xl font-semibold">해결책 재등록</h1>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (isSubmitDisabled) return
              resubmitMutation.mutate()
            }}
          >
            <NeuSelect
              id="error-type"
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
              id="solution"
              label="해결 내용"
              rows={6}
              placeholder="수정된 조치 내용을 구체적으로 기술해 주세요..."
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              required
            />

            <NeuTextarea
              id="revision-reason"
              label="재등록 사유 (선택)"
              rows={3}
              placeholder="반려 사유에 어떻게 대응했는지 적어주세요. 승인자에게 함께 전달됩니다."
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
            />

            {/* 기존 첨부파일 (읽기 전용 참고용) */}
            {feedback.attachments.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-text-secondary text-sm font-medium">
                  기존 첨부파일 (참고용)
                </span>
                <ul className="flex flex-col gap-2">
                  {feedback.attachments.map((att) => {
                    const isImage = isImagePath(att.file_path)
                    const url = attachmentUrl(att.file_path)
                    const name = att.original_filename ?? att.file_path.split('/').pop() ?? '파일'
                    return (
                      <li
                        key={att.id}
                        className="border-border bg-bg-deep flex items-center gap-3 rounded-sm border p-2 opacity-60"
                      >
                        {isImage ? (
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={url}
                              alt={name}
                              className="h-10 w-10 rounded-sm object-cover"
                            />
                          </a>
                        ) : (
                          <span className="text-text-secondary flex h-10 w-10 shrink-0 items-center justify-center">
                            <FileText className="h-6 w-6" />
                          </span>
                        )}
                        <span className="text-text-secondary min-w-0 flex-1 truncate text-sm">
                          {name}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {/* 새 첨부파일 */}
            <div className="flex flex-col gap-2">
              <span className="text-text-secondary text-sm font-medium">새 첨부파일</span>

              {/* 안내 메시지 */}
              <div className="border-border-brand bg-bg-deep flex items-start gap-2 rounded-sm border p-2">
                <Info className="text-warning mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-text-secondary text-xs">
                  재등록 시 첨부파일은 새로 등록한 것으로 교체됩니다. 기존 첨부파일을 유지하려면
                  동일한 파일을 다시 첨부해 주세요.
                </p>
              </div>

              {newAttachments.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {newAttachments.map((att, idx) => (
                    <li
                      key={`${att.filePath}-${idx}`}
                      className="border-border bg-bg-deep flex items-center gap-3 rounded-sm border p-2"
                    >
                      {att.previewUrl ? (
                        <img
                          src={att.previewUrl}
                          alt={att.originalFilename}
                          className="h-10 w-10 rounded-sm object-cover"
                        />
                      ) : (
                        <span className="text-text-secondary flex h-10 w-10 shrink-0 items-center justify-center">
                          <FileText className="h-6 w-6" />
                        </span>
                      )}
                      <span className="text-text-primary min-w-0 flex-1 truncate text-sm">
                        {att.originalFilename}
                      </span>
                      <button
                        type="button"
                        aria-label={`${att.originalFilename} 제거`}
                        onClick={() => handleRemoveNewAttachment(idx)}
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
                className="hidden"
                onChange={handleFileChange}
              />
              <NeuButton
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="mr-1.5 h-4 w-4" />
                {uploadMutation.isPending ? '업로드 중...' : '파일 첨부'}
              </NeuButton>
              <p className="text-text-disabled text-xs">
                이미지, PDF, Excel, Word, 텍스트 파일 지원
              </p>
            </div>

            <NeuButton type="submit" className="w-full" disabled={isSubmitDisabled}>
              {resubmitMutation.isPending ? '재등록 중...' : '재등록하기'}
            </NeuButton>
          </form>
        </NeuCard>
      </div>
    </div>
  )
}

export default FeedbackRevisePage
