import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { ROUTES } from '@/constants/routes'
import { useDashboardHealth } from '@/hooks/queries/useDashboardHealth'
import { useAgentHealthSummary } from '@/hooks/queries/useAgents'
import { useWebSocketDashboard } from '@/hooks/useWebSocket'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { DashboardSummaryStats } from '@/components/dashboard/DashboardSummary'
import { TrendMonitorSection } from '@/components/dashboard/TrendMonitorSection'
import { SystemHealthGrid } from '@/components/dashboard/SystemHealthGrid'
import { NeuButton } from '@/components/neumorphic/NeuButton'
import { formatKST, cn } from '@/lib/utils'

export function DashboardPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastAlertUpdate, setLastAlertUpdate] = useState<Date | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const { data: dashboardData, isLoading, error, refetch } = useDashboardHealth()
  const { data: agentHealth } = useAgentHealthSummary()

  // "X초 전" 자동 갱신 — lastAlertUpdate 존재 시에만 interval 동작
  useEffect(() => {
    if (!lastAlertUpdate) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [lastAlertUpdate])

  // WebSocket 연결 (실시간 알림 수신)
  const { isConnected: wsConnected, isConnecting: wsConnecting } = useWebSocketDashboard({
    onMessage: (message) => {
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

  const handleStatusCardClick = useCallback(
    (status: 'critical' | 'warning' | 'normal') => {
      const next = new URLSearchParams(searchParams)
      next.set('status', status)
      setSearchParams(next, { replace: true })
      // 다음 tick에 스크롤 (필터 반영 후)
      requestAnimationFrame(() => {
        document
          .getElementById('system-grid')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [searchParams, setSearchParams],
  )

  const summary = dashboardData?.summary
  const systems = dashboardData?.systems ?? []
  const lastUpdated = summary?.last_updated ? new Date(summary.last_updated) : new Date()

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <PageHeader
        title="운영 대시보드"
        description={`${systems.length}개 시스템 · 최근 10분 기준`}
        action={
          <NeuButton
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            새로고침
          </NeuButton>
        }
      />

      {/* WebSocket 상태 + 갱신 시각 — 헤더 하단 보조 정보 */}
      <div
        className={cn(
          '-mt-3 flex flex-wrap items-center gap-1.5 text-xs',
          wsConnected ? 'text-normal-text' : 'text-text-secondary',
        )}
      >
        {wsConnected ? (
          <>
            <Wifi className="h-3 w-3 flex-shrink-0" />
            <span>실시간 알림 수신 중</span>
            {lastAlertUpdate && (
              <span className="text-text-secondary">
                · {Math.max(0, Math.floor((now - lastAlertUpdate.getTime()) / 1000))}초 전
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
        <span className="text-text-disabled">
          · 갱신 {formatKST(lastUpdated.toISOString(), 'HH:mm:ss')}
        </span>
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
          {/* 상단: compact 통계 바 (클릭 가능, 6카드 구성) */}
          <DashboardSummaryStats
            summary={summary}
            agentSummary={agentHealth}
            onStatusCardClick={handleStatusCardClick}
          />

          {/* 추이 모니터 — 전체/다중 시스템 집계 추이 */}
          <TrendMonitorSection systems={systems} />

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
        </>
      ) : null}
    </div>
  )
}
