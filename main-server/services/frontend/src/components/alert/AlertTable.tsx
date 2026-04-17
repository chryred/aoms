import { useMemo } from 'react'
import { Bell, CheckCircle } from 'lucide-react'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { AnomalyTypeBadge } from './AnomalyTypeBadge'
import { formatAlertTitle } from './alertTitle'
import { EmptyState } from '@/components/common/EmptyState'
import { useSystems } from '@/hooks/queries/useSystems'
import { formatRelative } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { AlertHistory } from '@/types/alert'

const ALERT_TYPE_LABELS: Record<string, string> = {
  metric: '메트릭',
  log_analysis: '로그분석',
}

function getTypeLabel(alert: AlertHistory): string {
  if (alert.alert_type === 'metric' && alert.resolved_at) return '복구'
  if ((alert.alert_type as string) === 'metric_resolved') return '복구'
  return ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type
}

interface AlertTableProps {
  alerts: AlertHistory[]
  onSelect: (alert: AlertHistory) => void
}

export function AlertTable({ alerts, onSelect }: AlertTableProps) {
  const { data: systems = [] } = useSystems()
  const systemMap = useMemo(
    () =>
      systems.reduce<Record<number, string>>((acc, s) => {
        acc[s.id] = s.display_name
        return acc
      }, {}),
    [systems],
  )

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="h-12 w-12" />}
        title="알림 이력이 없습니다"
        description="조건에 맞는 알림이 없습니다"
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-border border-b">
            {['ID', '심각도', '유형', '시스템', '제목', '이상 유형', '발생 시각', '확인'].map(
              (h) => (
                <th
                  key={h}
                  className="text-text-primary px-4 py-3 text-left text-xs font-semibold tracking-wider whitespace-nowrap uppercase"
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
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
                'focus-visible:bg-accent-muted focus-visible:outline-none',
                alert.acknowledged && 'opacity-60',
              )}
            >
              <td className="text-text-secondary px-4 py-3 font-mono text-xs whitespace-nowrap">
                #{alert.id}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <SeverityBadge severity={alert.severity} />
              </td>
              <td className="text-text-secondary px-4 py-3 text-xs whitespace-nowrap">
                {getTypeLabel(alert)}
              </td>
              <td className="px-4 py-3">
                <p className="text-text-primary max-w-[140px] truncate text-sm">
                  {alert.system_id != null ? (systemMap[alert.system_id] ?? '-') : '-'}
                </p>
              </td>
              <td className="px-4 py-3">
                <p className="text-text-primary max-w-xs truncate text-sm font-medium">
                  {formatAlertTitle(alert.title)}
                </p>
                {alert.alertname && (
                  <p className="text-text-secondary font-mono text-xs">{alert.alertname}</p>
                )}
              </td>
              <td className="px-4 py-3">
                {alert.error_message ? (
                  <NeuBadge
                    variant="critical"
                    // 툴팁으로 실패 사유 노출 (브라우저 기본 title 속성)
                    // NeuBadge가 title을 프로퍼티로 받지 않는 경우 span으로 래핑
                  >
                    <span title={alert.error_message}>분석 실패</span>
                  </NeuBadge>
                ) : (
                  <AnomalyTypeBadge type={alert.anomaly_type} />
                )}
              </td>
              <td className="text-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                {formatRelative(alert.created_at)}
              </td>
              <td className="px-4 py-3">
                {alert.acknowledged ? (
                  <CheckCircle className="text-normal h-4 w-4" />
                ) : (
                  <span className="bg-critical inline-block h-2 w-2 rounded-full" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
