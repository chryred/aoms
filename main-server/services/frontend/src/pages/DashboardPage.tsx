import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { useDashboardHealth } from '@/hooks/queries/useDashboardHealth'
import { useAgentHealthSummary } from '@/hooks/queries/useAgents'
import { useWebSocketDashboard } from '@/hooks/useWebSocket'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { DashboardSummaryStats } from '@/components/dashboard/DashboardSummary'
import { SystemHealthGrid } from '@/components/dashboard/SystemHealthGrid'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { formatKST, cn } from '@/lib/utils'

export function DashboardPage() {
  const navigate = useNavigate()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastAlertUpdate, setLastAlertUpdate] = useState<Date | null>(null)

  const { data: dashboardData, isLoading, error, refetch } = useDashboardHealth()
  const { data: agentHealth } = useAgentHealthSummary()

  // WebSocket 연결 (실시간 알림 수신)
  const { isConnected: wsConnected, isConnecting: wsConnecting } = useWebSocketDashboard({
    onMessage: (message) => {
      // 알림이 도착하면 UI에 피드백
      setLastAlertUpdate(new Date())
      console.log('[Dashboard] Received real-time update:', message.type)
    },
  })

  const handleAddSystem = useCallback(() => navigate(ROUTES.SYSTEMS), [navigate])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refetch()
    } finally {
      setIsRefreshing(false)
    }
  }, [refetch])

  const summary = dashboardData?.summary
  const systems = dashboardData?.systems ?? []
  const lastUpdated = summary?.last_updated ? new Date(summary.last_updated) : new Date()

  return (
    <div className="space-y-6">
      {/* 헤더 + WebSocket 상태 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <PageHeader
            title="운영 대시보드"
            description={`마지막 갱신: ${formatKST(lastUpdated.toISOString(), 'HH:mm:ss')}`}
          />
          {/* WebSocket 상태 표시 */}
          <div
            className={cn(
              '-mt-4 flex flex-wrap items-center gap-1.5 text-xs',
              wsConnected ? 'text-green-500' : 'text-text-secondary',
            )}
          >
            {wsConnected ? (
              <>
                <Wifi className="h-3 w-3 flex-shrink-0" />
                <span>실시간 알림 수신 중</span>
                {lastAlertUpdate && (
                  <span className="text-text-secondary">
                    · {Math.floor((Date.now() - lastAlertUpdate.getTime()) / 1000)}초 전
                  </span>
                )}
              </>
            ) : wsConnecting ? (
              <>
                <Wifi className="h-3 w-3 flex-shrink-0 animate-pulse" />
                <span>실시간 연결 중...</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 flex-shrink-0" />
                <span>실시간 연결 대기</span>
              </>
            )}
          </div>
        </div>
        <NeuButton
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="mt-1 flex flex-shrink-0 items-center gap-2 whitespace-nowrap"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          새로고침
        </NeuButton>
      </div>

      {isLoading ? (
        <>
          <LoadingSkeleton shape="card" count={4} />
          <LoadingSkeleton shape="card" count={6} />
        </>
      ) : error ? (
        <ErrorCard onRetry={() => refetch()} />
      ) : summary ? (
        <>
          {/* 상단: compact 통계 바 (로그분석 통계 통합) */}
          <DashboardSummaryStats summary={summary} agentSummary={agentHealth} />

          {/* 시스템 카드 그리드 + 필터 */}
          <section className="space-y-4">
            <h2 className="text-text-primary text-lg font-semibold">
              모니터링 시스템
              <span className="text-text-secondary ml-2 text-sm font-normal">
                ({systems.length}개)
              </span>
            </h2>
            <SystemHealthGrid systems={systems} onAddSystem={handleAddSystem} />
          </section>

          {/* 하단: 최근 알림 피드 (향후: WebSocket 연동) */}
          {/* <section>
            <h2 className="mb-4 text-lg font-semibold text-text-primary">
              최근 알림
            </h2>
            <AlertFeed alerts={recentAlerts ?? []} loading={alertsLoading} />
          </section> */}
        </>
      ) : null}
    </div>
  )
}
