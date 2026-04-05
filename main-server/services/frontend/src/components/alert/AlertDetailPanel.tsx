import { useEffect, useRef } from 'react'
import { X, CheckCircle } from 'lucide-react'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { AnomalyTypeBadge } from './AnomalyTypeBadge'
import { useAcknowledgeAlert } from '@/hooks/mutations/useAcknowledgeAlert'
import { useAuthStore } from '@/store/authStore'
import { formatKST } from '@/lib/utils'
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
  const panelRef = useRef<HTMLDivElement>(null)

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
      if (e.key === 'Escape') { onClose(); return }
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
      { onSuccess: onClose }
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
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[460px] bg-[#1E2127]
                   shadow-[-8px_0_32px_rgba(0,0,0,0.4)] border-l border-[#2B2F37] flex flex-col"
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#2B2F37]">
          <div className="flex items-center gap-2 flex-wrap">
            <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</NeuBadge>
            <span className="text-sm text-[#8B97AD]">
              {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
            </span>
            {alert.acknowledged && (
              <NeuBadge variant="normal">
                <CheckCircle className="w-3 h-3 mr-0.5" />확인됨
              </NeuBadge>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="알림 상세 닫기"
            className="rounded-sm p-1.5 text-[#8B97AD] hover:bg-[rgba(255,255,255,0.05)]
                       focus:outline-none focus:ring-1 focus:ring-[#00D4FF]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
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
            {alert.alertname && (
              <div>
                <p className="type-label">Alert Name</p>
                <p className="mt-0.5 text-[#E2E8F2] font-mono text-xs break-all">{alert.alertname}</p>
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
                <p className="mt-0.5 text-[#E2E8F2] font-mono text-xs break-all">{alert.host}</p>
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
              <div className="rounded-sm bg-[#1E2127] shadow-[inset_2px_2px_5px_#111317,inset_-2px_-2px_5px_#2B2F37] p-4">
                <p className="text-sm text-[#E2E8F2] whitespace-pre-wrap leading-relaxed break-words">
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
          <div className="px-6 py-4 border-t border-[#2B2F37]">
            <NeuButton
              className="w-full"
              loading={isPending}
              onClick={handleAck}
            >
              <CheckCircle className="w-4 h-4" />
              확인 처리
            </NeuButton>
          </div>
        )}
      </div>
    </>
  )
}
