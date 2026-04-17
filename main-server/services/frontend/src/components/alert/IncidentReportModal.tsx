import { useEffect, useRef } from 'react'
import { X, FileText, Copy, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { useGenerateIncidentReport } from '@/hooks/mutations/useGenerateIncidentReport'
import type { AlertHistory, Severity } from '@/types/alert'

const SEVERITY_VARIANT: Record<Severity, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '위험',
  warning: '경고',
  info: '정보',
}

interface IncidentReportModalProps {
  alert: AlertHistory | null
  systemName?: string
  onClose: () => void
}

export function IncidentReportModal({ alert, systemName, onClose }: IncidentReportModalProps) {
  const { mutate, data, isPending, isError, reset } = useGenerateIncidentReport()
  const closeRef = useRef<HTMLButtonElement>(null)

  // alert가 세팅될 때마다 자동 생성
  useEffect(() => {
    if (!alert) {
      reset()
      return
    }
    mutate(alert.id)
  }, [alert?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC 닫기
  useEffect(() => {
    if (!alert) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    closeRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [alert, onClose])

  if (!alert) return null

  const report = data?.report ?? ''

  const handleCopy = () => {
    if (!report) return
    navigator.clipboard.writeText(report).then(() => {
      toast.success('장애요약이 복사됐습니다')
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      {/* 오버레이 */}
      <div className="bg-overlay absolute inset-0" onClick={onClose} aria-hidden="true" />

      {/* 모달 본체 */}
      <NeuCard className="relative mx-4 flex w-full max-w-2xl max-h-[80vh] flex-col p-0 overflow-hidden">
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

        {/* 서브헤더: 알림 정보 */}
        <div className="border-border flex items-center gap-2 border-b px-5 py-2.5">
          <span className="text-text-secondary font-mono text-xs">#{alert.id}</span>
          <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</NeuBadge>
          {systemName && (
            <span className="text-text-secondary text-xs">{systemName}</span>
          )}
        </div>

        {/* 액션 바 */}
        <div className="border-border flex items-center justify-end border-b px-5 py-2">
          <NeuButton
            variant="ghost"
            size="sm"
            disabled={!report || isPending}
            onClick={handleCopy}
          >
            <Copy className="h-3.5 w-3.5" />
            복사
          </NeuButton>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isPending && (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-border animate-pulse rounded-sm h-4 w-full" style={{ width: `${70 + (i % 3) * 10}%` }} />
              ))}
            </div>
          )}

          {isError && !isPending && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-critical text-sm">장애요약 생성에 실패했습니다.</p>
              <NeuButton size="sm" variant="ghost" onClick={() => mutate(alert.id)}>
                <RefreshCw className="h-3.5 w-3.5" />
                재시도
              </NeuButton>
            </div>
          )}

          {!isPending && !isError && report && (
            <pre className="text-text-primary font-mono text-sm leading-relaxed whitespace-pre-wrap break-words">
              {report}
            </pre>
          )}
        </div>
      </NeuCard>
    </div>
  )
}
