import { useEffect, useRef, useState } from 'react'
import { X, CheckCircle, ChevronDown } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { NeuSelect } from '@/components/neumorphic/NeuSelect'
import { NeuTextarea } from '@/components/neumorphic/NeuTextarea'
import { AnomalyTypeBadge } from './AnomalyTypeBadge'
import { useAcknowledgeAlert } from '@/hooks/mutations/useAcknowledgeAlert'
import { useCreateFeedback } from '@/hooks/mutations/useCreateFeedback'
import { useAuthStore } from '@/store/authStore'
import { cn, formatKST } from '@/lib/utils'
import type { AlertHistory, Severity } from '@/types/alert'

const SEVERITY_VARIANT: Record<Severity, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  metric: '메트릭 알림',
  metric_resolved: '메트릭 복구',
  log_analysis: '로그 분석',
}

const PANEL_TITLE_ID = 'alert-detail-panel-title'

interface AlertDetailPanelProps {
  alert: AlertHistory | null
  onClose: () => void
}

export function AlertDetailPanel({ alert, onClose }: AlertDetailPanelProps) {
  const user = useAuthStore((s) => s.user)
  const { mutate: acknowledge, isPending } = useAcknowledgeAlert()
  const { mutate: createFeedback, isPending: isFeedbackPending } = useCreateFeedback()
  const panelRef = useRef<HTMLDivElement>(null)

  const [showSolution, setShowSolution] = useState(false)
  const [errorType, setErrorType] = useState('기타')
  const [solution, setSolution] = useState('')

  // Reset solution fields when alert changes
  useEffect(() => {
    setShowSolution(false)
    setErrorType('기타')
    setSolution('')
  }, [alert?.id])

  // Focus trap + ESC close
  useEffect(() => {
    if (!alert) return

    const panel = panelRef.current
    if (!panel) return

    const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const getFocusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))

    // Focus first element on open
    const focusables = getFocusable()
    focusables[0]?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const focusables = getFocusable()
      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [alert, onClose])

  if (!alert) return null

  const handleAck = () => {
    acknowledge(
      { id: alert.id, by: user?.name ?? 'unknown' },
      {
        onSuccess: () => {
          if (showSolution && solution.trim()) {
            createFeedback(
              {
                alert_history_id: alert.id,
                error_type: errorType,
                solution: solution.trim(),
                resolver: user?.name ?? 'unknown',
              },
              { onSuccess: onClose, onError: onClose },
            )
          } else {
            onClose()
          }
        },
      },
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={PANEL_TITLE_ID}
        className="fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-[460px] flex-col border-l border-[#2B2F37] bg-[#1E2127] shadow-[-8px_0_32px_rgba(0,0,0,0.4)]"
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between border-b border-[#2B2F37] px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</NeuBadge>
            <span className="text-sm text-[#8B97AD]">
              {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
            </span>
            {alert.acknowledged && (
              <NeuBadge variant="normal">
                <CheckCircle className="mr-0.5 h-3 w-3" />
                확인됨
              </NeuBadge>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="알림 상세 닫기"
            className="rounded-sm p-1.5 text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)] focus:ring-1 focus:ring-[#00D4FF] focus:outline-none"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <h3 id={PANEL_TITLE_ID} className="text-base font-semibold text-[#E2E8F2]">
              {alert.title}
            </h3>
          </div>

          {/* 메타 정보 */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="type-label">발생 시각</p>
              <p className="mt-0.5 text-[#E2E8F2]">{formatKST(alert.created_at)}</p>
            </div>
            {alert.resolved_at && (
              <div>
                <p className="type-label">복구 시각</p>
                <p className="mt-0.5 text-[#22C55E]">{formatKST(alert.resolved_at)}</p>
              </div>
            )}
            {alert.alertname && (
              <div>
                <p className="type-label">Alert Name</p>
                <p className="mt-0.5 font-mono text-xs break-all text-[#E2E8F2]">
                  {alert.alertname}
                </p>
              </div>
            )}
            {alert.instance_role && (
              <div>
                <p className="type-label">인스턴스 역할</p>
                <p className="mt-0.5 text-[#E2E8F2]">{alert.instance_role}</p>
              </div>
            )}
            {alert.host && (
              <div>
                <p className="type-label">호스트</p>
                <p className="mt-0.5 font-mono text-xs break-all text-[#E2E8F2]">{alert.host}</p>
              </div>
            )}
          </div>

          {/* 유사도 분석 */}
          {alert.anomaly_type && (
            <div>
              <p className="type-label mb-1.5">이상 유형</p>
              <AnomalyTypeBadge type={alert.anomaly_type} score={alert.similarity_score} />
            </div>
          )}

          {/* 설명 */}
          {alert.description && (
            <div>
              <p className="type-label mb-1.5">상세 내용</p>
              <div className="rounded-sm bg-[#1E2127] p-4 shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37]">
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-[#E2E8F2]">
                  {alert.description}
                </p>
              </div>
            </div>
          )}

          {/* 확인 처리 이력 */}
          {alert.acknowledged && alert.acknowledged_by && (
            <div>
              <p className="type-label mb-1.5">처리 정보</p>
              <p className="text-sm text-[#8B97AD]">
                {alert.acknowledged_by}
                {alert.acknowledged_at && ` · ${formatKST(alert.acknowledged_at)}`}
              </p>
            </div>
          )}
        </div>

        {/* 푸터 */}
        {!alert.acknowledged && (
          <div className="space-y-3 border-t border-[#2B2F37] px-6 py-4">
            <button
              type="button"
              onClick={() => setShowSolution((v) => !v)}
              className="flex w-full items-center gap-2 text-sm text-[#8B97AD] hover:text-[#E2E8F2] focus:outline-none"
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', showSolution && 'rotate-180')}
              />
              해결책 함께 등록
            </button>

            {showSolution && (
              <div className="space-y-3">
                <NeuSelect
                  id="error-type"
                  label="장애 유형"
                  value={errorType}
                  onChange={(e) => setErrorType(e.target.value)}
                >
                  <option value="DB 연결 오류">DB 연결 오류</option>
                  <option value="메모리 부족">메모리 부족</option>
                  <option value="디스크 부족">디스크 부족</option>
                  <option value="네트워크 오류">네트워크 오류</option>
                  <option value="타임아웃">타임아웃</option>
                  <option value="애플리케이션 오류">애플리케이션 오류</option>
                  <option value="기타">기타</option>
                </NeuSelect>
                <NeuTextarea
                  id="solution"
                  label="해결 내용"
                  rows={4}
                  placeholder="수행한 조치 내용을 기술해 주세요..."
                  value={solution}
                  onChange={(e) => setSolution(e.target.value)}
                />
              </div>
            )}

            <NeuButton
              className="w-full"
              loading={isPending || isFeedbackPending}
              onClick={handleAck}
            >
              <CheckCircle className="h-4 w-4" />
              {showSolution && solution.trim() ? '확인 처리 + 해결책 등록' : '확인 처리'}
            </NeuButton>
          </div>
        )}
      </div>
    </>
  )
}
