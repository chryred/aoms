import { memo } from 'react'
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

// 개별 알림 카드 — props가 바뀌지 않으면 리렌더 생략
const AlertFeedItem = memo(function AlertFeedItem({ alert }: { alert: AlertHistory }) {
  return (
    <NeuCard
      severity={
        alert.severity === 'critical'
          ? 'critical'
          : alert.severity === 'warning'
            ? 'warning'
            : undefined
      }
      className="flex items-start gap-3 py-4"
    >
      <div className="mt-0.5 shrink-0">
        <NeuBadge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</NeuBadge>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-[#E2E8F2]">{alert.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[#8B97AD]">{alert.alertname ?? alert.alert_type}</span>
          <span className="text-xs text-[#5A6478]">·</span>
          <span className="text-xs text-[#5A6478]">{formatRelative(alert.created_at)}</span>
          <AnomalyTypeBadge type={alert.anomaly_type} />
        </div>
      </div>
    </NeuCard>
  )
})

interface AlertFeedProps {
  alerts: AlertHistory[]
  loading?: boolean
}

export function AlertFeed({ alerts, loading }: AlertFeedProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#E2E8F2]">
          미확인 알림
          {alerts.length > 0 && (
            <span className="ml-2 text-sm font-normal text-[#8B97AD]">({alerts.length}건)</span>
          )}
        </h2>
        <Link
          to="/alerts"
          className="flex items-center gap-1 rounded text-sm text-[#00D4FF] hover:underline focus:ring-1 focus:ring-[#00D4FF] focus:outline-none"
        >
          전체 보기 <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading ? (
        <LoadingSkeleton shape="table" count={3} />
      ) : alerts.length === 0 ? (
        <NeuCard>
          <EmptyState
            icon={<Bell className="h-10 w-10" />}
            title="미확인 알림이 없습니다"
            description="모든 알림이 정상 처리되었습니다"
          />
        </NeuCard>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <AlertFeedItem key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </section>
  )
}
