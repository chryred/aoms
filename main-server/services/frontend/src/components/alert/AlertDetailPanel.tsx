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

interface AlertDetailPanelProps {
  alert: AlertHistory | null
  onClose: () => void
}

export function AlertDetailPanel({ alert, onClose }: AlertDetailPanelProps) {
  const user = useAuthStore((s) => s.user)
  const { mutate: acknowledge, isPending } = useAcknowledgeAlert()

  if (!alert) return null

  const handleAck = () => {
    acknowledge(
      { id: alert.id, by: user?.name ?? 'unknown' },
      { onSuccess: onClose }
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-[460px] bg-[#E8EBF0]
                      shadow-[-8px_0_32px_rgba(0,0,0,0.12)] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[#D4D7DE]">
          <div className="flex items-center gap-2 flex-wrap">
            <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</NeuBadge>
            <span className="text-sm text-[#4A5568]">
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
            aria-label="닫기"
            className="rounded-lg p-1.5 text-[#4A5568] hover:bg-[rgba(0,0,0,0.05)]
                       focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-[#1A1F2E]">{alert.title}</h3>
          </div>

          {/* 메타 정보 */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-[#A0A4B0] uppercase tracking-wider">발생 시각</p>
              <p className="mt-0.5 text-[#1A1F2E]">{formatKST(alert.created_at)}</p>
            </div>
            {alert.alertname && (
              <div>
                <p className="text-xs font-medium text-[#A0A4B0] uppercase tracking-wider">Alert Name</p>
                <p className="mt-0.5 text-[#1A1F2E] font-mono text-xs">{alert.alertname}</p>
              </div>
            )}
            {alert.instance_role && (
              <div>
                <p className="text-xs font-medium text-[#A0A4B0] uppercase tracking-wider">인스턴스 역할</p>
                <p className="mt-0.5 text-[#1A1F2E]">{alert.instance_role}</p>
              </div>
            )}
            {alert.host && (
              <div>
                <p className="text-xs font-medium text-[#A0A4B0] uppercase tracking-wider">호스트</p>
                <p className="mt-0.5 text-[#1A1F2E] font-mono text-xs">{alert.host}</p>
              </div>
            )}
          </div>

          {/* 유사도 분석 */}
          {alert.anomaly_type && (
            <div>
              <p className="text-xs font-medium text-[#A0A4B0] uppercase tracking-wider mb-1.5">이상 유형</p>
              <AnomalyTypeBadge type={alert.anomaly_type} score={alert.similarity_score} />
            </div>
          )}

          {/* 설명 */}
          {alert.description && (
            <div>
              <p className="text-xs font-medium text-[#A0A4B0] uppercase tracking-wider mb-1.5">상세 내용</p>
              <div className="rounded-xl bg-[#E8EBF0] shadow-[inset_4px_4px_8px_#C8CBD4,inset_-4px_-4px_8px_#FFFFFF] p-4">
                <p className="text-sm text-[#1A1F2E] whitespace-pre-wrap leading-relaxed">
                  {alert.description}
                </p>
              </div>
            </div>
          )}

          {/* 확인 처리 이력 */}
          {alert.acknowledged && alert.acknowledged_by && (
            <div>
              <p className="text-xs font-medium text-[#A0A4B0] uppercase tracking-wider mb-1.5">처리 정보</p>
              <p className="text-sm text-[#4A5568]">
                {alert.acknowledged_by}
                {alert.acknowledged_at && ` · ${formatKST(alert.acknowledged_at)}`}
              </p>
            </div>
          )}
        </div>

        {/* 푸터 */}
        {!alert.acknowledged && (
          <div className="px-6 py-4 border-t border-[#D4D7DE]">
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
