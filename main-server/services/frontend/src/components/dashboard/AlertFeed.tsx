import { Link } from 'react-router-dom'
import { Bell, ArrowRight } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { AnomalyTypeBadge } from '@/components/alert/AnomalyTypeBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { formatRelative } from '@/lib/utils'
import type { AlertHistory, Severity } from '@/types/alert'

const SEVERITY_VARIANT: Record<Severity, 'critical' | 'warning' | 'info'> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
}

interface AlertFeedProps {
  alerts: AlertHistory[]
  loading?: boolean
}

export function AlertFeed({ alerts, loading }: AlertFeedProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-[#1A1F2E]">
          미확인 알림
          {alerts.length > 0 && (
            <span className="ml-2 text-sm font-normal text-[#4A5568]">({alerts.length}건)</span>
          )}
        </h2>
        <Link
          to="/alerts"
          className="flex items-center gap-1 text-sm text-[#6366F1] hover:underline
                     focus:outline-none focus:ring-2 focus:ring-[#6366F1] rounded"
        >
          전체 보기 <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {loading ? (
        <LoadingSkeleton shape="table" count={3} />
      ) : alerts.length === 0 ? (
        <NeuCard>
          <EmptyState
            icon={<Bell className="w-10 h-10" />}
            title="미확인 알림이 없습니다"
            description="모든 알림이 정상 처리되었습니다"
          />
        </NeuCard>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <NeuCard
              key={alert.id}
              severity={alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : undefined}
              className="flex items-start gap-3 py-4"
            >
              <div className="shrink-0 mt-0.5">
                <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>
                  {alert.severity}
                </NeuBadge>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1A1F2E] line-clamp-2">{alert.title}</p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-[#4A5568]">
                    {alert.alertname ?? alert.alert_type}
                  </span>
                  <span className="text-xs text-[#A0A4B0]">·</span>
                  <span className="text-xs text-[#A0A4B0]">{formatRelative(alert.created_at)}</span>
                  <AnomalyTypeBadge type={alert.anomaly_type} />
                </div>
              </div>
            </NeuCard>
          ))}
        </div>
      )}
    </section>
  )
}
