import { Bell, CheckCircle } from 'lucide-react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { AnomalyTypeBadge } from './AnomalyTypeBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { AlertHistory, Severity } from '@/types/alert'

const SEVERITY_VARIANT: Record<Severity, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  metric: '메트릭',
  metric_resolved: '복구',
  log_analysis: '로그분석',
}

interface AlertTableProps {
  alerts: AlertHistory[]
  onSelect: (alert: AlertHistory) => void
}

export function AlertTable({ alerts, onSelect }: AlertTableProps) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="w-12 h-12" />}
        title="알림 이력이 없습니다"
        description="조건에 맞는 알림이 없습니다"
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#2B2F37]">
            {['심각도', '유형', '제목', '이상 유형', '발생 시각', '확인'].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left type-label"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#2B2F37]">
          {alerts.map((alert) => (
            <tr
              key={alert.id}
              onClick={() => onSelect(alert)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(alert)
                }
              }}
              tabIndex={0}
              aria-label={`알림: ${alert.title} (${alert.severity})`}
              className={cn(
                'cursor-pointer transition-colors',
                'hover:bg-[rgba(0,212,255,0.04)]',
                'focus-visible:outline-none focus-visible:bg-[rgba(0,212,255,0.06)]',
                alert.acknowledged && 'opacity-60'
              )}
            >
              <td className="px-4 py-3">
                <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>
                  {alert.severity}
                </NeuBadge>
              </td>
              <td className="px-4 py-3">
                <NeuBadge variant="muted">
                  {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
                </NeuBadge>
              </td>
              <td className="px-4 py-3">
                <p className="text-sm font-medium text-[#E2E8F2] max-w-xs truncate">
                  {alert.title}
                </p>
                {alert.alertname && (
                  <p className="text-xs text-[#8B97AD] font-mono">{alert.alertname}</p>
                )}
              </td>
              <td className="px-4 py-3">
                <AnomalyTypeBadge type={alert.anomaly_type} />
              </td>
              <td className="px-4 py-3 text-sm text-[#8B97AD] whitespace-nowrap">
                {formatRelative(alert.created_at)}
              </td>
              <td className="px-4 py-3">
                {alert.acknowledged ? (
                  <CheckCircle className="w-4 h-4 text-[#22C55E]" />
                ) : (
                  <span className="inline-block w-2 h-2 rounded-full bg-[#EF4444]" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
