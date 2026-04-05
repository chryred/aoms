import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '@/constants/routes'
import { useSystems } from '@/hooks/queries/useSystems'
import { useAlerts } from '@/hooks/queries/useAlerts'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { SystemStatusGrid } from '@/components/dashboard/SystemStatusGrid'
import { AlertFeed } from '@/components/dashboard/AlertFeed'
import { formatKST } from '@/lib/utils'

export function DashboardPage() {
  const navigate = useNavigate()
  const [lastRefreshed, setLastRefreshed] = useState(new Date())

  const {
    data: systems,
    isLoading: systemsLoading,
    error: systemsError,
    refetch: refetchSystems,
  } = useSystems()

  const { data: recentAlerts, isLoading: alertsLoading } = useAlerts({
    acknowledged: false,
    limit: 10,
  })

  useEffect(() => {
    if (systems) setLastRefreshed(new Date())
  }, [systems])

  const handleAddSystem = useCallback(() => navigate(ROUTES.SYSTEMS), [navigate])

  return (
    <div className="space-y-8">
      <PageHeader
        title="운영 대시보드"
        description={`마지막 갱신: ${formatKST(lastRefreshed.toISOString(), 'HH:mm')}`}
      />

      {/* 시스템 상태 그리드 */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-[#E2E8F2]">
          모니터링 시스템
          {systems && (
            <span className="ml-2 text-sm font-normal text-[#8B97AD]">({systems.length}개)</span>
          )}
        </h2>
        {systemsLoading ? (
          <LoadingSkeleton shape="card" count={6} />
        ) : systemsError ? (
          <ErrorCard onRetry={refetchSystems} />
        ) : (
          <SystemStatusGrid systems={systems ?? []} onAddSystem={handleAddSystem} />
        )}
      </section>

      {/* 알림 피드 */}
      <AlertFeed alerts={recentAlerts ?? []} loading={alertsLoading} />
    </div>
  )
}
