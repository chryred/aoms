import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react'
import { useSystemDetailHealth } from '@/hooks/queries/useDashboardHealth'
import { useHourlyAggregations, useCollectorConfigs } from '@/hooks/queries/useAggregations'
import { useSystemLiveStatus } from '@/hooks/queries/useAgents'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { ErrorCard } from '@/components/common/ErrorCard'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { NeuBadge } from '@/components/neumorphic/NeuBadge'
import { MetricChart } from '@/components/charts/MetricChart'
import { getMetricKeys } from '@/lib/metrics-transform'
import { formatKST, cn } from '@/lib/utils'
import type { HourlyAggregation } from '@/types/aggregation'

type TimeRange = '6h' | '12h' | '24h' | '48h'
const HOURS_MAP: Record<TimeRange, number> = { '6h': 6, '12h': 12, '24h': 24, '48h': 48 }

const CHART_TITLES: Record<string, string> = {
  cpu: 'CPU 사용률',
  memory: '메모리 사용률',
  disk: '디스크 I/O',
  network: '네트워크 트래픽',
  log: '로그 에러 추이',
  web: '웹 요청 추이',
  db_connections: 'DB 커넥션',
  db_query: 'DB 쿼리 처리량',
  db_cache: 'DB 캐시 적중률',
  db_replication: 'DB 복제 지연',
}

const UNIT_MAP: Record<string, string | undefined> = {
  cpu: '%',
  memory: '%',
  disk: 'MB',
  network: 'MB',
  db_cache: '%',
  db_replication: 's',
}

/** 수집 여부 기본 판정 (hourly 데이터 또는 live 에이전트 기준) */
function isCollecting(aggs: HourlyAggregation[], isSystemLive: boolean): boolean {
  if (aggs.length === 0) return isSystemLive
  // hour_bucket은 DB에서 UTC naive로 저장되므로 'Z'를 붙여 UTC로 파싱
  const latest = Math.max(...aggs.map((a) => new Date(a.hour_bucket + 'Z').getTime()))
  return Date.now() - latest < 2 * 3_600_000
}

/** 퍼센트 기반 상태 판정에 사용할 대표 키 */
const PCT_KEY: Record<string, Record<string, string>> = {
  synapse_agent: { cpu: 'cpu_avg', memory: 'mem_used_pct' },
  node_exporter: { cpu: 'cpu_avg', memory: 'mem_avg', disk: 'disk_avg' },
  db_exporter:   { db_connections: 'conn_active_pct', db_cache: 'cache_hit_rate' },
}

function computeAvgPct(
  aggs: HourlyAggregation[],
  collectorType: string,
  group: string,
): number | null {
  const key = PCT_KEY[collectorType]?.[group]
  if (!key || aggs.length === 0) return null
  const values = aggs
    .map((a) => {
      try {
        const m = JSON.parse(a.metrics_json) as Record<string, number>
        return typeof m[key] === 'number' ? m[key] : null
      } catch {
        return null
      }
    })
    .filter((v): v is number => v !== null)
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

type MetricStatus = 'inactive' | 'collecting' | 'normal' | 'warning' | 'critical'

const STATUS_CFG: Record<MetricStatus, { label: string; color: string; dot: string }> = {
  inactive:   { label: '미수집',  color: 'text-[#8B97AD]', dot: 'text-[#8B97AD]' },
  collecting: { label: '수집 중', color: 'text-[#22C55E]', dot: 'text-[#22C55E]' },
  normal:     { label: '정상',    color: 'text-[#22C55E]', dot: 'text-[#22C55E]' },
  warning:    { label: '경고',    color: 'text-[#F59E0B]', dot: 'text-[#F59E0B]' },
  critical:   { label: '심각',    color: 'text-[#EF4444]', dot: 'text-[#EF4444]' },
}

function getMetricStatus(
  aggs: HourlyAggregation[],
  isSystemLive: boolean,
  collectorType: string,
  group: string,
): { status: MetricStatus; avg: number | null } {
  if (!isCollecting(aggs, isSystemLive)) return { status: 'inactive', avg: null }
  if (aggs.length === 0) return { status: 'collecting', avg: null }
  const avg = computeAvgPct(aggs, collectorType, group)
  if (avg === null) return { status: 'collecting', avg: null }
  if (avg <= 60) return { status: 'normal', avg }
  if (avg <= 80) return { status: 'warning', avg }
  return { status: 'critical', avg }
}

export function DashboardSystemDetailPage() {
  const { systemId } = useParams<{ systemId: string }>()
  const navigate = useNavigate()

  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  const [collectorType, setCollectorType] = useState<string | undefined>(undefined)
  const [chartPopup, setChartPopup] = useState<{ group: string; aggs: HourlyAggregation[] } | null>(null)

  const { data: detail, isLoading, error, refetch } = useSystemDetailHealth(systemId)

  const numericId = Number(systemId)
  const { fromDt, toDt } = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - HOURS_MAP[timeRange] * 3_600_000)
    return { fromDt: from.toISOString(), toDt: to.toISOString() }
  }, [timeRange])

  const { data: hourly = [] } = useHourlyAggregations({
    system_id: numericId,
    from_dt: fromDt,
    to_dt: toDt,
  })
  const { data: collectorConfigs = [] } = useCollectorConfigs(numericId || undefined)
  const { data: systemLive } = useSystemLiveStatus(numericId || undefined)
  const isSystemLive = systemLive?.is_live ?? false

  if (!systemId) {
    return (
      <div className="py-8 text-center">
        <p className="text-[#8B97AD]">시스템을 선택해주세요</p>
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

  // collector-config 기반으로 수집기 목록 결정 (hourly 데이터 없어도 항목 표시)
  const configuredCollectors = [...new Set(collectorConfigs.map((c) => c.collector_type))]
  const hourlyCollectors = [...new Set(hourly.map((a) => a.collector_type))]
  const availableCollectors = configuredCollectors.length > 0 ? configuredCollectors : hourlyCollectors

  const activeCollector =
    collectorType && availableCollectors.includes(collectorType)
      ? collectorType
      : (availableCollectors[0] ?? '')

  // activeCollector의 설정된 metric_group 목록 (데이터 없는 항목도 포함)
  const configuredGroups = collectorConfigs
    .filter((c) => c.collector_type === activeCollector && c.enabled)
    .map((c) => c.metric_group)

  // hourly 데이터를 metric_group별로 그룹화
  const filteredHourly = hourly.filter((a) => a.collector_type === activeCollector)
  const groupedMetrics = filteredHourly.reduce<Record<string, HourlyAggregation[]>>((acc, agg) => {
    if (!acc[agg.metric_group]) acc[agg.metric_group] = []
    acc[agg.metric_group].push(agg)
    return acc
  }, {})

  // 표시할 전체 metric_group: 설정된 항목 + 데이터가 있는 항목 합집합
  const allGroups = [...new Set([...configuredGroups, ...Object.keys(groupedMetrics)])]

  const severityConfig = {
    critical: {
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      icon: AlertCircle,
    },
    warning: {
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      icon: AlertTriangle,
    },
    info: {
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      icon: CheckCircle,
    },
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="space-y-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-[#8B97AD] transition-colors hover:text-[#E2E8F2]"
        >
          <ArrowLeft className="h-5 w-5" />
          돌아가기
        </button>
        <div className="space-y-1">
          <h1 className="text-xl leading-tight font-bold break-words text-[#E2E8F2] sm:text-2xl">
            {detail.display_name}
          </h1>
          <p className="font-mono text-xs break-all text-[#8B97AD] sm:text-sm">
            {detail.system_name}
          </p>
        </div>
      </div>

      {/* 메트릭 추이 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#E2E8F2]">메트릭 추이</h2>

        {/* 시간 범위 선택 */}
        <div className="flex w-fit gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]">
          {(['6h', '12h', '24h', '48h'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={cn(
                'rounded-sm px-3 py-1 text-xs font-medium transition-all',
                timeRange === r
                  ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                  : 'text-[#8B97AD] hover:bg-white/5 hover:text-[#E2E8F2]',
              )}
            >
              최근 {r}
            </button>
          ))}
        </div>

        {/* 수집기 타입 선택 — 복수일 때만 */}
        {availableCollectors.length > 1 && (
          <div className="flex w-fit flex-wrap gap-1 rounded-sm bg-[#1E2127] p-1 shadow-[inset_1px_1px_3px_#111317,inset_-1px_-1px_3px_#2B2F37]">
            {availableCollectors.map((ct) => (
              <button
                key={ct}
                onClick={() => setCollectorType(ct)}
                className={cn(
                  'rounded-sm px-3 py-1 text-xs font-medium transition-all',
                  activeCollector === ct
                    ? 'bg-[#00D4FF] font-semibold text-[#1E2127] shadow-[2px_2px_4px_#111317]'
                    : 'text-[#8B97AD] hover:bg-white/5 hover:text-[#E2E8F2]',
                )}
              >
                {ct}
              </button>
            ))}
          </div>
        )}

        {/* 수집 현황 — 항상 표시 */}
        {allGroups.length === 0 ? (
          <NeuCard className="py-6 text-center text-sm text-[#8B97AD]">
            수집기 설정이 없습니다
          </NeuCard>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {allGroups.map((group) => {
              const aggs = groupedMetrics[group] ?? []
              const { status, avg } = getMetricStatus(aggs, isSystemLive, activeCollector, group)
              const cfg = STATUS_CFG[status]
              const clickable = status !== 'inactive'
              return (
                <div
                  key={group}
                  onClick={() => clickable && setChartPopup({ group, aggs })}
                  className={cn(
                    'flex items-center justify-between rounded-sm bg-[#1E2127] px-3 py-2 shadow-[2px_2px_5px_#111317,-2px_-2px_5px_#2B2F37] transition-colors',
                    clickable && 'cursor-pointer hover:bg-[#252932]',
                  )}
                >
                  <span className="text-xs font-medium text-[#A8B5C3]">
                    {CHART_TITLES[group] ?? group}
                  </span>
                  <span className={cn('flex items-center gap-1 text-xs font-medium', cfg.color)}>
                    <span className={cn('text-[8px]', cfg.dot)}>●</span>
                    {cfg.label}
                    {avg !== null && (
                      <span className="font-mono text-[10px] opacity-80">({avg.toFixed(0)}%)</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* 차트 — 데이터 있는 항목만 */}
        {Object.keys(groupedMetrics).length > 0 && (
          <div className="flex flex-col gap-4">
            {Object.entries(groupedMetrics).map(([group, aggs]) => {
              const keys = getMetricKeys(activeCollector, group, aggs[0]?.metrics_json)
              return (
                <div
                  key={group}
                  className="rounded-sm bg-[#1E2127] p-4 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]"
                >
                  <h3 className="mb-3 text-sm font-semibold text-[#E2E8F2]">
                    {CHART_TITLES[group] ?? group}
                    {UNIT_MAP[group] && ` (${UNIT_MAP[group]})`}
                  </h3>
                  <MetricChart
                    aggregations={aggs}
                    metricKeys={keys}
                    title=""
                    unit={UNIT_MAP[group]}
                  />
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 1️⃣ 활성 알림 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E2E8F2]">활성 알림</h2>
          {detail.metric_alerts.length > 0 && (
            <NeuBadge variant="critical">{detail.metric_alerts.length}개</NeuBadge>
          )}
        </div>

        {detail.metric_alerts.length === 0 ? (
          <NeuCard className="py-8 text-center text-[#8B97AD]">활성 알림이 없습니다</NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.metric_alerts.map((alert) => (
              <div key={`${alert.alert_type}-${alert.id}`} className="transition-all duration-150 hover:shadow-lg">
                <NeuCard
                  className={cn(
                    'border-l-4 transition-all duration-150',
                    alert.severity === 'critical'
                      ? 'border-l-red-500/50'
                      : 'border-l-yellow-500/50',
                  )}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded-sm bg-[#2A3447]/60 px-1.5 py-0.5 font-mono text-[10px] text-[#8B97AD]">
                          {alert.alert_type === 'log_analysis' ? '로그분석' : '메트릭'}
                        </span>
                      </div>
                      <h3 className="line-clamp-2 leading-tight font-semibold break-words text-[#E2E8F2]">
                        {alert.alertname}
                      </h3>
                      <div className="mt-1.5 flex items-center gap-2 text-xs text-[#8B97AD]">
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        <span>{formatKST(alert.created_at, 'HH:mm:ss')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                      <NeuBadge variant={alert.severity === 'critical' ? 'critical' : 'warning'}>
                        {alert.severity.toUpperCase()}
                      </NeuBadge>
                      {alert.value && (
                        <p className="font-mono text-sm text-[#A8B5C3]">{alert.value}</p>
                      )}
                    </div>
                  </div>
                </NeuCard>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2️⃣ 최근 로그분석 결과 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#E2E8F2]">로그분석 결과 (최근 1시간)</h2>
          {detail.log_analysis.latest_count > 0 && (
            <NeuBadge variant="info">{detail.log_analysis.latest_count}건</NeuBadge>
          )}
        </div>

        {/* 요약 통계 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="transition-all duration-150 hover:shadow-lg">
            <NeuCard className="border-l-4 border-red-500/30 py-4 text-center transition-all duration-150">
              <p className="mb-1 text-sm text-[#8B97AD]">Critical</p>
              <p className="text-2xl font-bold text-red-500">
                {detail.log_analysis.critical_count}
              </p>
            </NeuCard>
          </div>
          <div className="transition-all duration-150 hover:shadow-lg">
            <NeuCard className="border-l-4 border-yellow-500/30 py-4 text-center transition-all duration-150">
              <p className="mb-1 text-sm text-[#8B97AD]">Warning</p>
              <p className="text-2xl font-bold text-yellow-500">
                {detail.log_analysis.warning_count}
              </p>
            </NeuCard>
          </div>
          <div className="transition-all duration-150 hover:shadow-lg">
            <NeuCard className="border-l-4 border-blue-500/30 py-4 text-center transition-all duration-150">
              <p className="mb-1 text-sm text-[#8B97AD]">전체</p>
              <p className="text-2xl font-bold text-blue-500">{detail.log_analysis.latest_count}</p>
            </NeuCard>
          </div>
        </div>

        {/* 상세 이상 목록 */}
        {detail.log_analysis.incidents.length === 0 ? (
          <NeuCard className="py-8 text-center text-[#8B97AD]">최근 로그 이상이 없습니다</NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.log_analysis.incidents.map((incident) => {
              const config = severityConfig[incident.severity as keyof typeof severityConfig]
              const Icon = config.icon
              return (
                <div key={incident.id} className="transition-all duration-150 hover:shadow-lg">
                  <NeuCard
                    className={cn(
                      'border-l-4 transition-all duration-150',
                      incident.severity === 'critical'
                        ? 'border-l-red-500/50'
                        : incident.severity === 'warning'
                          ? 'border-l-yellow-500/50'
                          : 'border-l-blue-500/50',
                    )}
                  >
                    <div className="space-y-3">
                      {/* 헤더 */}
                      <div className="flex items-start gap-2">
                        <Icon className={cn('mt-1 h-4 w-4 flex-shrink-0', config.color)} />
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-[#8B97AD] uppercase">
                              {incident.anomaly_type === 'duplicate' && '🔄 반복 이상'}
                              {incident.anomaly_type === 'recurring' && '⚠️ 반복 이상'}
                              {incident.anomaly_type === 'related' && '🔗 유사 이상'}
                              {incident.anomaly_type === 'new' && '⚡ 신규 이상'}
                            </p>
                            <NeuBadge
                              variant={incident.severity === 'critical' ? 'critical' : 'warning'}
                            >
                              {incident.severity.toUpperCase()}
                            </NeuBadge>
                          </div>
                          <p className="line-clamp-2 text-sm leading-snug font-semibold break-words text-[#E2E8F2]">
                            {incident.log_message}
                          </p>
                        </div>
                      </div>

                      {/* LLM 분석 결과 */}
                      <div className="rounded-md border border-[#2A3447]/50 bg-[#2A3447]/30 p-3">
                        <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-[#8B97AD]">
                          <span>💡</span>
                          분석 결과
                        </p>
                        <p className="line-clamp-4 text-sm leading-relaxed break-words text-[#A8B5C3]">
                          {incident.analysis_result}
                        </p>
                      </div>

                      {/* 시간 */}
                      <div className="text-xs text-[#8B97AD]">
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

      {/* 3️⃣ 예방적 패턴 감지 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#E2E8F2]">
            <ShieldAlert className="h-5 w-5 text-purple-400" />
            예방적 패턴 감지
          </h2>
          {detail.proactive_alerts.length > 0 && (
            <NeuBadge variant="info">{detail.proactive_alerts.length}건</NeuBadge>
          )}
        </div>

        {detail.proactive_alerts.length === 0 ? (
          <NeuCard className="py-6 text-center text-[#8B97AD]">
            <ShieldAlert className="mx-auto mb-2 h-8 w-8 opacity-20" />
            <p className="text-sm">감지된 예방 패턴이 없습니다</p>
          </NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.proactive_alerts.map((alert) => (
              <div key={alert.id} className="transition-all duration-150 hover:shadow-lg">
                <NeuCard
                  className={cn(
                    'border-l-4 transition-all duration-150',
                    alert.llm_severity === 'critical'
                      ? 'border-l-red-500/40'
                      : 'border-l-purple-500/40',
                  )}
                >
                  <div className="space-y-3">
                    {/* 헤더 */}
                    <div className="flex items-start justify-between gap-3 sm:gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <TrendingUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-400" />
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold break-words text-[#E2E8F2]">
                            <span className="mr-1 inline-block rounded bg-[#2A3447]/40 px-1.5 py-0.5 font-mono text-xs">
                              {alert.collector_type}
                            </span>
                            {alert.metric_group}
                          </p>
                          <p className="mt-1 text-xs text-[#8B97AD]">
                            {formatKST(alert.hour_bucket, 'datetime')} 집계
                          </p>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <NeuBadge
                          variant={alert.llm_severity === 'critical' ? 'critical' : 'warning'}
                        >
                          {alert.llm_severity?.toUpperCase()}
                        </NeuBadge>
                      </div>
                    </div>

                    {/* 트렌드 */}
                    {alert.llm_trend && (
                      <div className="rounded-md border border-[#2A3447]/50 bg-[#2A3447]/30 p-3">
                        <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-[#8B97AD]">
                          <span>📈</span>
                          트렌드
                        </p>
                        <p className="text-sm leading-relaxed break-words text-[#A8B5C3]">
                          {alert.llm_trend}
                        </p>
                      </div>
                    )}

                    {/* 예측 */}
                    <div className="rounded-md border border-purple-500/25 bg-purple-500/5 p-3">
                      <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-purple-400">
                        <span>⚡</span>
                        예측
                      </p>
                      <p className="max-h-32 overflow-y-auto text-sm leading-relaxed break-words text-[#E2E8F2]">
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

      {/* 4️⃣ 담당자 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#E2E8F2]">담당자</h2>

        {detail.contacts.length === 0 ? (
          <NeuCard className="py-8 text-center text-[#8B97AD]">등록된 담당자가 없습니다</NeuCard>
        ) : (
          <div className="grid gap-3">
            {detail.contacts.map((contact) => (
              <div key={contact.id} className="transition-all duration-150 hover:shadow-lg">
                <NeuCard className="transition-all duration-150">
                  <div className="flex items-start justify-between gap-3 sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold break-words text-[#E2E8F2]">{contact.name}</h3>
                      <p className="mt-1 font-mono text-xs break-all text-[#8B97AD] sm:text-sm">
                        {contact.teams_upn}
                      </p>
                      {contact.phone && (
                        <p className="mt-1 text-xs text-[#8B97AD] sm:text-sm">{contact.phone}</p>
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
      <div className="py-4 text-center text-xs text-[#8B97AD]">
        마지막 업데이트: {formatKST(detail.last_updated, 'datetime')}
      </div>

      {/* 차트 팝업 */}
      {chartPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setChartPopup(null)}
        >
          <div
            className="w-full max-w-2xl rounded-sm bg-[#1E2127] p-5 shadow-[6px_6px_16px_#111317,-6px_-6px_16px_#2B2F37]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 팝업 헤더 */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-[#E2E8F2]">
                  {CHART_TITLES[chartPopup.group] ?? chartPopup.group}
                  {UNIT_MAP[chartPopup.group] && (
                    <span className="ml-1 text-sm font-normal text-[#8B97AD]">
                      ({UNIT_MAP[chartPopup.group]})
                    </span>
                  )}
                </h3>
                <p className="mt-0.5 text-xs text-[#8B97AD]">최근 {timeRange} 추이</p>
              </div>
              <button
                onClick={() => setChartPopup(null)}
                className="rounded-sm p-1 text-[#8B97AD] transition-colors hover:bg-white/5 hover:text-[#E2E8F2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* 차트 */}
            {chartPopup.aggs.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#8B97AD]">
                집계 데이터가 아직 없습니다.
                <br />
                에이전트가 수집 중이며 1시간 이내 데이터가 표시됩니다.
              </div>
            ) : (
              <MetricChart
                aggregations={chartPopup.aggs}
                metricKeys={getMetricKeys(
                  activeCollector,
                  chartPopup.group,
                  chartPopup.aggs[0]?.metrics_json,
                )}
                title=""
                unit={UNIT_MAP[chartPopup.group]}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
