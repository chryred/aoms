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

  const eventSecondsAgo = lastAlertUpdate
    ? Math.max(0, Math.floor((now - lastAlertUpdate.getTime()) / 1000))
    : null

  return (
    <div className="space-y-6">
      {/* 헤더 블록 — 제목 + 실시간 메타. 내부는 자연스러운 tight rhythm */}
      <header>
        <PageHeader
          title="운영 대시보드"
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

        {/* 메타 바 — 상태 배지 + 메타데이터 조각들. 각 조각은 독립 span, dot은 aria-hidden */}
        <div className="-mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span
            className={cn(
              'flex items-center gap-1.5',
              wsConnected
                ? 'text-normal-text'
                : wsConnecting
                  ? 'text-warning-text'
                  : 'text-text-secondary',
            )}
          >
            {wsConnected ? (
              <Wifi className="h-3 w-3 flex-shrink-0" />
            ) : wsConnecting ? (
              <Wifi className="h-3 w-3 flex-shrink-0 animate-pulse" />
            ) : (
              <WifiOff className="h-3 w-3 flex-shrink-0" />
            )}
            {wsConnected
              ? '실시간 연결됨'
              : wsConnecting
                ? '실시간 연결 중...'
                : '실시간 연결 대기'}
          </span>

          <span aria-hidden className="text-text-disabled">
            ·
          </span>
          <span className="text-text-disabled">{systems.length}개 시스템</span>

          <span aria-hidden className="text-text-disabled">
            ·
          </span>
          <span className="text-text-disabled">최근 10분 기준</span>

          <span aria-hidden className="text-text-disabled">
            ·
          </span>
          <span className="text-text-disabled">
            갱신 {formatKST(lastUpdated.toISOString(), 'HH:mm:ss')}
          </span>

          {eventSecondsAgo !== null && (
            <>
              <span aria-hidden className="text-text-disabled">
                ·
              </span>
              <span className="text-text-disabled">최근 이벤트 {eventSecondsAgo}초 전</span>
            </>
          )}
        </div>
      </header>

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
          <section className="space-y-3">
            <div>
              <h2 className="type-heading text-text-primary text-lg font-semibold">
                모니터링 시스템
              </h2>
              <p className="text-text-disabled mt-1 max-w-[60ch] text-xs leading-relaxed">
                시스템별 상태·메트릭·이상 감지 내역. 시스템 이름 클릭 시 상세 페이지로 이동합니다.
              </p>
            </div>
            <SystemHealthGrid systems={systems} onAddSystem={handleAddSystem} />
          </section>
        </>
      ) : null}
    </div>
  )
}
