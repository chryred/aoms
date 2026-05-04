import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useRegisterScreenContext } from '@/store/chatContextStore'
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldAlert,
  TrendingUp,
  CheckCheck,
} from 'lucide-react'
import { useSystemDetailHealth } from '@/hooks/queries/useDashboardHealth'
import { useMetricDashboard, HOURS_MAP } from '@/hooks/useMetricDashboard'
import type { TimeRange } from '@/hooks/useMetricDashboard'
import { TraceDotChart } from '@/components/dashboard/TraceDotChart'
import { TraceDetailPanel } from '@/components/trace/TraceDetailPanel'
import { ROUTES } from '@/constants/routes'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { MetricChartGrid, MetricChartPopup } from '@/components/dashboard/MetricChartGrid'
import { ProcessTreemap } from '@/components/dashboard/ProcessTreemap'
import { formatKST, formatRelative, cn } from '@/lib/utils'
import { useAcknowledgeAlert } from '@/hooks/mutations/useAcknowledgeAlert'
import { useAuthStore } from '@/store/authStore'

const severityConfig = {
  critical: { color: 'text-critical', bgColor: 'bg-critical/10', icon: AlertCircle },
  warning: { color: 'text-warning', bgColor: 'bg-warning/10', icon: AlertTriangle },
  info: { color: 'text-accent', bgColor: 'bg-accent/10', icon: CheckCircle },
}

export function DashboardSystemDetailPage() {
  const { systemId } = useParams<{ systemId: string }>()

  useRegisterScreenContext({ system_id: systemId })

  const [timeRange, setTimeRange] = useState<TimeRange>('6h')
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)

  const { data: detail, isLoading, error, refetch } = useSystemDetailHealth(systemId)
  const acknowledgeAlert = useAcknowledgeAlert()
  const currentUser = useAuthStore((s) => s.user)

  const numericId = Number(systemId)

  const {
    chartPopup,
    setChartPopup,
    popupClosing,
    closeChartPopup,
    adaptiveStep,
    hasOtel,
    minuteData,
    minuteLoading,
    processSummary,
    availableCollectors,
    collectorConfigs,
    liveSummaryByCt,
    isSystemLive,
    getGroupsForCt,
  } = useMetricDashboard(numericId, timeRange)

  if (!systemId) {
    return (
      <div className="py-8 text-center">
        <p className="text-text-secondary">시스템을 선택해주세요</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton shape="card" count={1} />
        <LoadingSkeleton shape="card" count={3} />
      </div>
    )
  }

  if (error || !detail) {
    return <ErrorCard onRetry={() => refetch()} />
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="space-y-3">
        <Link
          to="/dashboard"
          className="text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
          돌아가기
        </Link>
        <div className="space-y-1">
          <h2 className="text-text-primary text-xl leading-tight font-bold break-words sm:text-2xl">
            {detail.display_name}
          </h2>
          <p className="text-text-secondary font-mono text-xs break-all sm:text-sm">
            {detail.system_name}
          </p>
        </div>
      </div>

      {/* 수집 현황 */}
      <section className="space-y-4">
        <h2 className="text-text-primary text-lg font-semibold">수집 현황</h2>

        {/* 시간 범위 선택 */}
        <div className="bg-bg-base shadow-neu-pressed flex w-fit gap-1 rounded-sm p-1">
          {(['6h', '12h', '24h', '48h'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium transition-all duration-150 active:scale-[0.97]',
                timeRange === r
                  ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                  : 'text-text-secondary hover:bg-hover-subtle hover:text-text-primary',
              )}
            >
              최근 {r}
            </button>
          ))}
        </div>

        <MetricChartGrid
          systemId={numericId}
          timeRange={timeRange}
          availableCollectors={availableCollectors}
          collectorConfigs={collectorConfigs}
          liveSummaryByCt={liveSummaryByCt}
          isSystemLive={isSystemLive}
          getGroupsForCt={getGroupsForCt}
          onOpenChart={(group, collectorType) => setChartPopup({ group, collectorType })}
        />
      </section>

      {/* 프로세스 사용량 */}
      {processSummary.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-text-primary text-lg font-semibold">프로세스 사용량</h2>
          <ProcessTreemap data={processSummary} />
        </section>
      )}

      {/* 성능 분석 (OTel) */}
      <section className="space-y-4">
        <h2 className="text-text-primary text-lg font-semibold">성능 분석</h2>
        {hasOtel ? (
          <TraceDotChart
            systemId={numericId}
            systemName={detail.display_name}
            windowMinutes={HOURS_MAP[timeRange] * 60}
            height={280}
            onTraceSelect={setSelectedTraceId}
          />
        ) : (
          <NeuCard className="text-text-secondary py-6 text-center text-sm">
            OTel Java 수집기가 등록되지 않았습니다.
            <Link
              to={ROUTES.AGENTS}
              className="text-accent hover:text-accent/80 ml-2 font-medium underline-offset-2 hover:underline"
            >
              에이전트 관리에서 등록하기 →
            </Link>
          </NeuCard>
        )}
      </section>

      {/* 활성 알림 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-text-primary text-lg font-semibold">활성 알림</h2>
          {detail.metric_alerts.length > 0 && (
            <NeuBadge variant="critical">{detail.metric_alerts.length}개</NeuBadge>
          )}
        </div>

        {detail.metric_alerts.length === 0 ? (
          <NeuCard className="text-text-secondary py-8 text-center">활성 알림이 없습니다</NeuCard>
        ) : (
          <div className="grid gap-2">
            {detail.metric_alerts.map((alert) => (
              <div key={`${alert.alert_type}-${alert.id}`}>
                <NeuCard
                  className={cn(
                    'border-l-4 py-3',
                    alert.severity === 'critical' ? 'border-l-critical/50' : 'border-l-warning/50',
                  )}
                >
                  {/* 상단 행: 배지들 + 심각도 */}
                  <div className="mb-1.5 flex items-center gap-1.5 flex-wrap pr-2">
                    <span className="bg-btn-secondary text-text-secondary rounded-sm px-1.5 py-0.5 font-mono text-[10px] flex-shrink-0">
                      {alert.alert_type === 'log_analysis' ? '로그분석' : '메트릭'}
                    </span>
                    {alert.instance_role && (
                      <span className="bg-btn-secondary text-text-secondary rounded-sm px-1.5 py-0.5 font-mono text-[10px] flex-shrink-0">
                        {alert.instance_role}
                      </span>
                    )}
                    {alert.occurrence_count != null && alert.occurrence_count > 1 && (
                      <span className="bg-warning/10 text-warning rounded-sm px-1.5 py-0.5 font-mono text-[10px] flex-shrink-0">
                        {alert.occurrence_count}회
                      </span>
                    )}
                    <div className="ml-auto flex-shrink-0">
                      <NeuBadge
                        variant={
                          alert.severity === 'critical'
                            ? 'critical'
                            : alert.severity === 'warning'
                              ? 'warning'
                              : 'info'
                        }
                      >
                        {alert.severity.toUpperCase()}
                      </NeuBadge>
                    </div>
                  </div>

                  {/* 알림 제목 */}
                  <h3 className="text-text-primary line-clamp-2 text-sm leading-snug font-semibold break-words">
                    {alert.title || alert.alertname}
                  </h3>

                  {/* 하단 행: 시각 + 값 + 액션 */}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-text-secondary min-w-0">
                      <Clock className="h-3 w-3 flex-shrink-0" />
                      <span className="font-medium">{formatRelative(alert.created_at)}</span>
                      <span className="text-text-disabled">({formatKST(alert.created_at, 'HH:mm:ss')})</span>
                      {alert.value && (
                        <>
                          <span className="text-text-disabled">·</span>
                          <span className="font-mono text-text-secondary">{alert.value}</span>
                        </>
                      )}
                    </div>
                    {alert.alert_type === 'metric' && (
                      <button
                        onClick={() =>
                          acknowledgeAlert.mutate({
                            id: Number(alert.id),
                            by: currentUser?.name || currentUser?.email || 'unknown',
                          })
                        }
                        disabled={acknowledgeAlert.isPending}
                        className="flex items-center gap-1 text-[10px] text-text-disabled hover:text-normal transition-colors flex-shrink-0"
                        title="확인 처리"
                      >
                        <CheckCheck className="h-3 w-3" />
                        확인
                      </button>
                    )}
                  </div>
                </NeuCard>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 최근 로그분석 결과 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-text-primary text-lg font-semibold">로그분석 결과 (최근 1시간)</h2>
          {detail.log_analysis.latest_count > 0 && (
            <NeuBadge variant="info">{detail.log_analysis.latest_count}건</NeuBadge>
          )}
        </div>

        <NeuCard className="py-3">
          <div className="grid grid-cols-3 text-center">
            <div className="border-r border-border flex flex-col items-center gap-0.5 px-2">
              <span className="text-text-secondary text-xs">Critical</span>
              <span className="text-critical font-bold text-xl leading-none">
                {detail.log_analysis.critical_count}
              </span>
            </div>
            <div className="border-r border-border flex flex-col items-center gap-0.5 px-2">
              <span className="text-text-secondary text-xs">Warning</span>
              <span className="text-warning font-bold text-xl leading-none">
                {detail.log_analysis.warning_count}
              </span>
            </div>
            <div className="flex flex-col items-center gap-0.5 px-2">
              <span className="text-text-secondary text-xs">최근 30분</span>
              <span className="text-accent font-bold text-xl leading-none">
                {detail.log_analysis.thirty_min_count}
              </span>
            </div>
          </div>
        </NeuCard>

        {detail.log_analysis.incidents.length === 0 ? (
          <NeuCard className="text-text-secondary py-8 text-center">
            최근 로그 이상이 없습니다
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.log_analysis.incidents.map((incident) => {
              const config = severityConfig[incident.severity as keyof typeof severityConfig]
              const Icon = config.icon
              return (
                <div key={incident.id}>
                  <NeuCard
                    className={cn(
                      'border-l-4',
                      incident.severity === 'critical'
                        ? 'border-l-critical/50'
                        : incident.severity === 'warning'
                          ? 'border-l-warning/50'
                          : 'border-l-accent/50',
                    )}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start gap-2">
                        <Icon className={cn('mt-1 h-4 w-4 flex-shrink-0', config.color)} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <p className="text-text-secondary text-xs font-semibold uppercase">
                              {incident.anomaly_type === 'duplicate' && '🔄 반복 이상'}
                              {incident.anomaly_type === 'recurring' && '⚠️ 반복 이상'}
                              {incident.anomaly_type === 'related' && '🔗 유사 이상'}
                              {incident.anomaly_type === 'new' && '⚡ 신규 이상'}
                            </p>
                            <NeuBadge
                              variant={
                                incident.severity === 'critical'
                                  ? 'critical'
                                  : incident.severity === 'warning'
                                    ? 'warning'
                                    : 'info'
                              }
                            >
                              {incident.severity.toUpperCase()}
                            </NeuBadge>
                          </div>
                          <p className="text-text-primary line-clamp-2 text-sm leading-snug font-semibold break-words">
                            {incident.log_message}
                          </p>
                        </div>
                      </div>

                      <div className="border-btn-secondary bg-btn-secondary/50 rounded-sm border p-3">
                        <p className="text-text-secondary mb-2 flex items-center gap-1 text-xs font-semibold">
                          <span>💡</span>
                          분석 결과
                        </p>
                        <p className="text-text-tertiary line-clamp-4 text-sm leading-relaxed break-words">
                          {incident.analysis_result}
                        </p>
                      </div>

                      <div className="text-text-secondary text-xs">
                        {formatKST(incident.created_at, 'datetime')}
                      </div>
                    </div>
                  </NeuCard>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 예방적 패턴 감지 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-text-primary flex items-center gap-2 text-lg font-semibold">
            <ShieldAlert className="text-proactive-text h-5 w-5" />
            예방적 패턴 감지
          </h2>
          {detail.proactive_alerts.length > 0 && (
            <NeuBadge variant="info">{detail.proactive_alerts.length}건</NeuBadge>
          )}
        </div>

        {detail.proactive_alerts.length === 0 ? (
          <NeuCard className="text-text-secondary py-6 text-center">
            <ShieldAlert className="mx-auto mb-2 h-8 w-8 opacity-20" />
            <p className="text-sm">감지된 예방 패턴이 없습니다</p>
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.proactive_alerts.map((alert) => (
              <div key={alert.id}>
                <NeuCard
                  className={cn(
                    'border-l-4',
                    alert.llm_severity === 'critical'
                      ? 'border-l-critical/40'
                      : 'border-l-proactive/40',
                  )}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3 sm:gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <TrendingUp className="text-proactive-text mt-0.5 h-4 w-4 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-text-primary line-clamp-2 text-sm font-semibold break-words">
                            <span className="bg-btn-secondary mr-1 inline-block rounded-sm px-1.5 py-0.5 font-mono text-xs">
                              {alert.collector_type}
                            </span>
                            {alert.metric_group}
                          </p>
                          <p className="text-text-secondary mt-1 text-xs">
                            {formatKST(alert.hour_bucket, 'datetime')} 집계
                          </p>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <NeuBadge
                          variant={
                            alert.llm_severity === 'critical'
                              ? 'critical'
                              : alert.llm_severity === 'warning'
                                ? 'warning'
                                : 'info'
                          }
                        >
                          {alert.llm_severity?.toUpperCase()}
                        </NeuBadge>
                      </div>
                    </div>

                    {alert.llm_trend && (
                      <div className="border-btn-secondary bg-btn-secondary/50 rounded-sm border p-3">
                        <p className="text-text-secondary mb-2 flex items-center gap-1 text-xs font-semibold">
                          <span>📈</span>
                          트렌드
                        </p>
                        <p className="text-text-tertiary text-sm leading-relaxed break-words">
                          {alert.llm_trend}
                        </p>
                      </div>
                    )}

                    <div className="border-proactive-border bg-proactive-card-bg rounded-sm border p-3">
                      <p className="text-proactive-text mb-2 flex items-center gap-1 text-xs font-semibold">
                        <span>⚡</span>
                        예측
                      </p>
                      <p className="text-text-primary max-h-32 overflow-y-auto text-sm leading-relaxed break-words">
                        {alert.llm_prediction}
                      </p>
                    </div>
                  </div>
                </NeuCard>
              </div>
            ))}
          </div>
        )}
      </section>

      <TraceDetailPanel traceId={selectedTraceId} onClose={() => setSelectedTraceId(null)} />

      {/* 담당자 */}
      <section className="space-y-4">
        <h2 className="text-text-primary text-lg font-semibold">담당자</h2>

        {detail.contacts.length === 0 ? (
          <NeuCard className="text-text-secondary py-8 text-center">
            등록된 담당자가 없습니다
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.contacts.map((contact) => (
              <div key={contact.id}>
                <NeuCard>
                  <div className="flex items-start justify-between gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-text-primary font-semibold break-words">
                        {contact.name}
                      </h3>
                      <p className="text-text-secondary mt-1 font-mono text-xs break-all sm:text-sm">
                        {contact.teams_upn}
                      </p>
                      {contact.phone && (
                        <p className="text-text-secondary mt-1 text-xs sm:text-sm">
                          {contact.phone}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0">
                      <NeuBadge variant="info">{contact.role}</NeuBadge>
                    </div>
                  </div>
                </NeuCard>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 마지막 업데이트 */}
      <div className="text-text-secondary py-4 text-center text-xs">
        마지막 업데이트: {formatKST(detail.last_updated, 'datetime')}
      </div>

      {/* 차트 팝업 */}
      {chartPopup && (
        <MetricChartPopup
          chartPopup={chartPopup}
          popupClosing={popupClosing}
          timeRange={timeRange}
          adaptiveStep={adaptiveStep}
          minuteData={minuteData}
          minuteLoading={minuteLoading}
          onClose={closeChartPopup}
        />
      )}
    </div>
  )
}
