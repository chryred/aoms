import { useState, useRef, useEffect, memo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useRegisterScreenContext } from '@/store/chatContextStore'
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  ShieldAlert,
  TrendingUp,
  CheckCheck,
  ChevronDown,
} from 'lucide-react'
import { useSystemDetailHealth, type MetricAlert } from '@/hooks/queries/useDashboardHealth'
import { useMetricDashboard, HOURS_MAP } from '@/hooks/useMetricDashboard'
import type { TimeRange } from '@/hooks/useMetricDashboard'
import { TraceDotChart } from '@/components/dashboard/TraceDotChart'
import { TraceDetailPanel } from '@/components/trace/TraceDetailPanel'
import { ROUTES } from '@/constants/routes'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { SeverityBadge } from '@/components/charts/SeverityBadge'
import { MetricChartGrid, MetricChartPopup } from '@/components/dashboard/MetricChartGrid'
import { ProcessTreemap } from '@/components/dashboard/ProcessTreemap'
import { formatKST, formatRelative, cn } from '@/lib/utils'
import { useAcknowledgeAlert } from '@/hooks/mutations/useAcknowledgeAlert'
import { useAuthStore } from '@/store/authStore'
import type { User } from '@/types/auth'

const ActiveIssueItem = memo(function ActiveIssueItem({
  alert,
  acknowledgeAlert,
  currentUser,
}: {
  alert: MetricAlert
  acknowledgeAlert: ReturnType<typeof useAcknowledgeAlert>
  currentUser: User | null
}) {
  const [logExpanded, setLogExpanded] = useState(false)
  const [analysisExpanded, setAnalysisExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const logRef = useRef<HTMLParagraphElement>(null)
  const isLog = alert.alert_type === 'log_analysis'
  const hasAnalysis = isLog && (alert.analysis_result || alert.log_content)
  const analysisIsError =
    !alert.analysis_result || alert.analysis_result.trimStart().startsWith('{"error"')

  useEffect(() => {
    const el = logRef.current
    if (el) setIsTruncated(el.scrollHeight > el.clientHeight)
  }, [])

  return (
    <NeuCard
      severity={
        alert.severity === 'critical'
          ? 'critical'
          : alert.severity === 'warning'
            ? 'warning'
            : undefined
      }
      className="py-3"
    >
      {/* 상단 행: 배지들 + 심각도 */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 pr-2">
        <span className="bg-btn-secondary text-text-secondary flex-shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
          {isLog ? '로그분석' : '메트릭'}
        </span>
        {alert.instance_role && (
          <span className="bg-btn-secondary text-text-secondary flex-shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
            {alert.instance_role}
          </span>
        )}
        {alert.occurrence_count != null && alert.occurrence_count > 1 && (
          <span className="bg-warning/10 text-warning flex-shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[10px]">
            {alert.occurrence_count}회
          </span>
        )}
        <div className="ml-auto flex-shrink-0">
          <SeverityBadge severity={alert.severity} />
        </div>
      </div>

      {/* 제목 */}
      <h3 className="text-text-primary text-sm leading-snug font-semibold break-words">
        {alert.title || alert.alertname}
      </h3>

      {/* 로그 미리보기 (log_analysis only) */}
      {isLog && alert.log_content && (
        <>
          {logExpanded ? (
            <div className="bg-bg-deep shadow-neu-inset mt-1.5 max-h-[28rem] overflow-y-auto rounded-sm p-2">
              <pre className="text-text-secondary m-0 font-mono text-[11px] leading-snug break-all whitespace-pre-wrap">
                {alert.log_content}
              </pre>
            </div>
          ) : (
            <p
              ref={logRef}
              className="text-text-secondary mt-1 line-clamp-2 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap"
            >
              {alert.log_content}
            </p>
          )}
          {(isTruncated || logExpanded) && (
            <button
              type="button"
              aria-expanded={logExpanded}
              aria-label={`${alert.title || alert.alertname} 로그 ${logExpanded ? '접기' : '전체 보기'}`}
              className="text-text-disabled hover:text-accent mt-1 flex min-h-[1.5rem] items-center gap-0.5 px-1 text-[10px] transition-colors duration-150"
              onClick={() => setLogExpanded((v) => !v)}
            >
              <ChevronDown
                className={cn(
                  'h-3 w-3 transition-transform duration-150',
                  logExpanded && 'rotate-180',
                )}
              />
              {logExpanded ? '접기' : '전체 보기'}
            </button>
          )}
        </>
      )}

      {/* 분석 결과 토글 (log_analysis only) */}
      {hasAnalysis && (
        <div className="border-border mt-2 border-t pt-2">
          <button
            type="button"
            aria-expanded={analysisExpanded}
            aria-label={`${alert.title || alert.alertname} 분석 결과 ${analysisExpanded ? '접기' : '펼치기'}`}
            className="text-text-secondary hover:text-text-primary flex min-h-[1.5rem] items-center gap-1 px-1 text-[11px] font-semibold transition-colors duration-150"
            onClick={() => setAnalysisExpanded((v) => !v)}
          >
            <span>💡</span>
            <span>분석 결과</span>
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform duration-150',
                analysisExpanded && 'rotate-180',
              )}
            />
          </button>
          {analysisExpanded &&
            (analysisIsError ? (
              <p className="text-text-disabled mt-1.5 text-xs">분석 일시 실패 — 재시도 중</p>
            ) : (
              <p className="text-text-secondary mt-1.5 text-xs leading-relaxed break-words">
                {alert.analysis_result}
              </p>
            ))}
        </div>
      )}

      {/* 하단 행: 시각 + 값 + 액션 */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs">
          <Clock className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">{formatRelative(alert.created_at)}</span>
          <span className="text-text-disabled">({formatKST(alert.created_at, 'HH:mm:ss')})</span>
          {!isLog && alert.value && (
            <>
              <span className="text-text-disabled">·</span>
              <span className="text-text-secondary font-mono">{alert.value}</span>
            </>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {!isLog && (
            <button
              type="button"
              onClick={() =>
                acknowledgeAlert.mutate({
                  id: Number(alert.id),
                  by: currentUser?.name || currentUser?.email || 'unknown',
                })
              }
              disabled={acknowledgeAlert.isPending}
              aria-label={`${alert.title || alert.alertname} 확인 처리`}
              className="text-text-disabled hover:text-normal flex min-h-[1.5rem] items-center gap-1 px-1 text-[10px] transition-colors"
            >
              <CheckCheck className="h-3 w-3" />
              확인
            </button>
          )}
          <Link
            to={`${ROUTES.ALERTS}?alert_id=${alert.id}`}
            aria-label={`${alert.title || alert.alertname} 알림 이력 보기`}
            title="알림 이력에서 이 건 조회"
            className="text-text-disabled hover:text-accent flex min-h-[1.5rem] items-center px-1 transition-colors duration-150"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </NeuCard>
  )
})

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

      {/* 활성 이슈 (메트릭 + 로그분석 통합) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-text-primary text-lg font-semibold">활성 이슈</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {/* 위험 카운터 */}
            <div
              className={cn(
                'flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-sm transition-colors',
                detail.log_analysis.critical_count > 0
                  ? 'bg-critical/10 text-critical border-critical/30 border'
                  : 'border-border text-text-disabled border opacity-50',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'text-[10px]',
                  detail.log_analysis.critical_count > 0 ? 'text-critical' : 'text-text-disabled',
                )}
              >
                ●
              </span>
              <span className={detail.log_analysis.critical_count > 0 ? 'font-bold' : ''}>
                위험 {detail.log_analysis.critical_count}
              </span>
            </div>
            {/* 경고 카운터 */}
            <div
              className={cn(
                'flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-sm transition-colors',
                detail.log_analysis.warning_count > 0
                  ? 'bg-warning/10 text-warning border-warning/30 border'
                  : 'border-border text-text-disabled border opacity-50',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'text-[10px]',
                  detail.log_analysis.warning_count > 0 ? 'text-warning' : 'text-text-disabled',
                )}
              >
                ●
              </span>
              <span className={detail.log_analysis.warning_count > 0 ? 'font-bold' : ''}>
                경고 {detail.log_analysis.warning_count}
              </span>
            </div>
            {/* 30분 최근 건수 */}
            {detail.log_analysis.thirty_min_count > 0 && (
              <div className="border-border text-text-secondary flex items-center gap-1 rounded-sm border px-2 py-1 font-mono text-sm">
                <span className="text-text-disabled text-[10px]">↑</span>
                <span>30분 {detail.log_analysis.thirty_min_count}건</span>
              </div>
            )}
          </div>
        </div>

        {detail.metric_alerts.length === 0 ? (
          <NeuCard className="text-text-secondary py-8 text-center">활성 이슈가 없습니다</NeuCard>
        ) : (
          <div className="grid gap-2">
            {detail.metric_alerts.map((alert) => (
              <ActiveIssueItem
                key={`${alert.alert_type}-${alert.id}`}
                alert={alert}
                acknowledgeAlert={acknowledgeAlert}
                currentUser={currentUser}
              />
            ))}
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
              <NeuCard
                key={alert.id}
                severity={alert.llm_severity === 'critical' ? 'critical' : 'warning'}
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
                      {alert.llm_severity && <SeverityBadge severity={alert.llm_severity} />}
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
              <NeuCard key={contact.id}>
                <div className="flex items-start justify-between gap-3 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-text-primary font-semibold break-words">{contact.name}</h3>
                    <p className="text-text-secondary mt-1 font-mono text-xs break-all sm:text-sm">
                      {contact.teams_upn}
                    </p>
                    {contact.phone && (
                      <p className="text-text-secondary mt-1 text-xs sm:text-sm">{contact.phone}</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <NeuBadge variant="info">{contact.role}</NeuBadge>
                  </div>
                </div>
              </NeuCard>
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
          systemId={numericId}
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
