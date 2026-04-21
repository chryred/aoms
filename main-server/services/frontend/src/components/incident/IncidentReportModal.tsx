import { useEffect, useRef } from 'react'
import { X, FileText, Copy, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { useGenerateIncidentIncidentReport } from '@/hooks/queries/useIncidents'

interface IncidentReportModalProps {
  incidentId: number | null
  title?: string
  onClose: () => void
}

/**
 * 인시던트 기반 "오류 요약" 모달 — /api/v1/incidents/{id}/incident-report 호출.
 * 연결 알림과 해결책을 모두 반영한 장애 보고서를 LLM이 한국어로 작성.
 */
export function IncidentReportModal({ incidentId, title, onClose }: IncidentReportModalProps) {
  const { mutate, data, isPending, isError, reset } = useGenerateIncidentIncidentReport()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!incidentId) {
      reset()
      return
    }
    mutate(incidentId)
  }, [incidentId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!incidentId) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [incidentId, onClose])

  if (!incidentId) return null

  const report = data?.report ?? ''

  const handleCopy = () => {
    if (!report) return
    navigator.clipboard.writeText(report).then(() => {
      toast.success('장애요약이 복사됐습니다')
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="bg-overlay absolute inset-0" onClick={onClose} aria-hidden="true" />
      <NeuCard className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        {/* 헤더 */}
        <div className="border-border flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2">
            <FileText className="text-accent h-5 w-5" aria-hidden="true" />
            <span className="text-text-primary text-base font-semibold">장애보고 자동 작성</span>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="닫기"
            className="text-text-secondary hover:bg-hover-subtle focus:ring-accent rounded-sm p-1.5 focus:ring-1 focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 서브헤더 */}
        <div className="border-border flex items-center gap-2 border-b px-5 py-2.5">
          <span className="text-text-secondary font-mono text-xs">인시던트 #{incidentId}</span>
          {title && <span className="text-text-secondary line-clamp-1 text-xs">{title}</span>}
        </div>

        {/* 액션 바 */}
        <div className="border-border flex items-center justify-end border-b px-5 py-2">
          <NeuButton variant="ghost" size="sm" disabled={!report || isPending} onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" />
            복사
          </NeuButton>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isPending && (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-border h-4 w-full animate-pulse rounded-sm"
                  style={{ width: `${70 + (i % 3) * 10}%` }}
                />
              ))}
            </div>
          )}

          {isError && !isPending && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-critical text-sm">장애요약 생성에 실패했습니다.</p>
              <NeuButton size="sm" variant="ghost" onClick={() => mutate(incidentId)}>
                <RefreshCw className="h-3.5 w-3.5" />
                재시도
              </NeuButton>
            </div>
          )}

          {!isPending && !isError && report && (
            <pre className="text-text-primary font-mono text-sm leading-relaxed break-words whitespace-pre-wrap">
              {report}
            </pre>
          )}
        </div>
      </NeuCard>
    </div>
  )
}
