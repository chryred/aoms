import { useState, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { X, Info, Maximize2 } from 'lucide-react'
import {
  ComposedChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { MetricChart } from '@/components/charts/MetricChart'
import { aggregationsApi } from '@/api/aggregations'
import { getMetricKeys, extractInstanceSeries } from '@/lib/metrics-transform'
import {
  COLLECTOR_SECTION_LABELS,
  CHART_TITLES,
  UNIT_MAP,
  DEFAULT_HIDDEN_KEYS_BY_GROUP,
  METRIC_HINTS,
} from '@/lib/metrics-config'
import { cn } from '@/lib/utils'
import { ROUTES } from '@/constants/routes'
import { getMetricStatus, classifyByValue, STATUS_CFG, HOURS_MAP } from '@/hooks/useMetricDashboard'
import { useUiStore } from '@/store/uiStore'
import type { TimeRange } from '@/hooks/useMetricDashboard'
import type { HourlyAggregation } from '@/types/aggregation'

// 시맨틱 색상 쌍 (임계치 초과 시만 색상 부여, 정상·미등록은 muted)
const INST_WARNING_COLOR = { dark: '#F59E0B', light: '#D97706' }
const INST_CRITICAL_COLOR = { dark: '#EF4444', light: '#DC2626' }
const INST_MUTED_COLOR = { dark: '#8B97AD', light: '#6B7280' }

// 상태별 스파크라인 선 색상
const SPARK_LINE_COLOR: Record<string, { dark: string; light: string }> = {
  critical: { dark: '#EF4444', light: '#F43F5E' },
  warning: { dark: '#F59E0B', light: '#F97316' },
  normal: { dark: '#22C55E', light: '#10B981' },
  inactive: { dark: '#5A6478', light: '#9CA3AF' },
  unconfigured: { dark: '#5A6478', light: '#9CA3AF' },
}

// 그룹별 대표 메트릭 키 (스파크라인용 단일 지표)
const CARD_METRIC_KEY: Record<string, string> = {
  cpu: 'cpu_max',
  memory: 'mem_max',
  disk: 'disk_io_ms',
  network: 'net_rx_mb',
  log: 'log_errors',
  web: 'resp_avg_ms',
  db_connections: 'conn_active_pct',
  db_query: 'tps',
  db_cache: 'cache_hit_rate',
  db_replication: 'repl_lag_sec',
}

function getLatestValue(values: { ts: string; value: number | null }[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i].value !== null) return values[i].value as number
  }
  return null
}

function resolveInstColor(
  latestValue: number | null,
  collectorType: string,
  group: string,
  theme: 'dark' | 'light',
): string {
  if (latestValue === null) return INST_MUTED_COLOR[theme]
  const cls = classifyByValue(latestValue, collectorType, group)
  if (cls === 'critical') return INST_CRITICAL_COLOR[theme]
  if (cls === 'warning') return INST_WARNING_COLOR[theme]
  return INST_MUTED_COLOR[theme]
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span
      className="group/tip relative ml-1 inline-flex cursor-default items-center p-0.5 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <Info className="text-text-disabled h-3 w-3 flex-shrink-0" />
      <span className="shadow-neu-flat border-border bg-surface text-text-secondary pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-56 rounded-sm border px-2.5 py-2 text-[10px] leading-relaxed whitespace-pre-line opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100">
        {text}
      </span>
    </span>
  )
}

// 메트릭 그룹 → 인스턴스별 max 키 prefix 매핑 (backend RANGE_PROMQL_MAP 키와 일치해야 함)
const INST_METRIC_BASE: Record<string, string> = {
  cpu: 'cpu_max_by_inst',
  memory: 'mem_max_by_inst',
  disk: 'disk_io_max_by_inst',
  network: 'net_rx_max_by_inst',
  log: 'log_max_by_inst',
  web: 'web_max_by_inst',
}

interface CollectorConfig {
  id: number
  system_id: number
  collector_type: string
  metric_group: string
  enabled: boolean
}

interface MetricChartGridProps {
  systemId: number
  timeRange: TimeRange
  availableCollectors: string[]
  collectorConfigs: CollectorConfig[]
  liveSummaryByCt: Record<string, Record<string, number | null>>
  isSystemLive: boolean
  getGroupsForCt: (ct: string) => string[]
  onOpenChart: (group: string, collectorType: string) => void
}

interface ChartPopupProps {
  chartPopup: { group: string; collectorType: string }
  popupClosing: boolean
  timeRange: TimeRange
  adaptiveStep: number
  minuteData: HourlyAggregation[]
  minuteLoading: boolean
  onClose: () => void
}

interface SparkPoint {
  ts: string
  v: number | null
}

function MiniSparkline({
  data,
  metricKey,
  lineColor,
  isLoading,
  sparkId,
}: {
  data: HourlyAggregation[]
  metricKey: string | undefined
  lineColor: string
  isLoading: boolean
  sparkId: string
}) {
  const points = useMemo<SparkPoint[]>(() => {
    if (!metricKey || !data.length) return []
    return data.map((d) => {
      const parsed = JSON.parse(d.metrics_json) as Record<string, number>
      return {
        ts: d.hour_bucket,
        v: typeof parsed[metricKey] === 'number' ? parsed[metricKey] : null,
      }
    })
  }, [data, metricKey])

  if (isLoading) {
    return <div className="border-border/30 h-full animate-pulse rounded-sm bg-current opacity-5" />
  }

  if (points.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-text-disabled text-[10px]">추이 없음</span>
      </div>
    )
  }

  const gradId = `sg-${sparkId.replace(/[^a-zA-Z0-9]/g, '-')}`
  const lastIdx = points.length - 1

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 4, right: 5, left: 5, bottom: 3 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={lineColor}
          fill={`url(#${gradId})`}
          strokeWidth={1.5}
          dot={(props: { index: number; cx: number; cy: number }) => {
            if (props.index !== lastIdx || props.cy == null) return <g key={`d-${props.index}`} />
            return (
              <circle
                key={`d-${props.index}`}
                cx={props.cx}
                cy={props.cy}
                r={2.5}
                fill={lineColor}
                stroke="none"
              />
            )
          }}
          activeDot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MetricChartGrid({
  systemId,
  timeRange,
  availableCollectors,
  collectorConfigs,
  liveSummaryByCt,
  isSystemLive,
  getGroupsForCt,
  onOpenChart,
}: MetricChartGridProps) {
  const theme = useUiStore((s) => s.theme)

  const groupPairs = useMemo(() => {
    const pairs: { ct: string; group: string }[] = []
    for (const ct of availableCollectors) {
      for (const group of getGroupsForCt(ct)) {
        pairs.push({ ct, group })
      }
    }
    return pairs
  }, [availableCollectors, getGroupsForCt])

  const { fromDt, toDt, cardStep } = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - HOURS_MAP[timeRange] * 3_600_000)
    // ~72 data points regardless of time range
    const step = Math.max(300, Math.round((HOURS_MAP[timeRange] * 3600) / 72))
    return { fromDt: from.toISOString(), toDt: to.toISOString(), cardStep: step }
  }, [timeRange])

  const queries = useQueries({
    queries: groupPairs.map(({ ct, group }) => ({
      queryKey: ['metrics-range-card', systemId, ct, group, fromDt],
      queryFn: () =>
        aggregationsApi.getMetricsRange({
          system_id: systemId,
          collector_type: ct,
          metric_group: group,
          start_dt: fromDt,
          end_dt: toDt,
          step: cardStep,
        }),
      staleTime: 300_000,
      gcTime: 600_000,
    })),
  })

  const sparkByKey = useMemo(() => {
    const map = new Map<string, HourlyAggregation[]>()
    groupPairs.forEach(({ ct, group }, i) => {
      const data = queries[i]?.data
      if (data?.length) map.set(`${ct}::${group}`, data)
    })
    return map
  }, [queries, groupPairs])

  const sparkIndexByKey = useMemo(() => {
    const map = new Map<string, number>()
    groupPairs.forEach(({ ct, group }, i) => map.set(`${ct}::${group}`, i))
    return map
  }, [groupPairs])

  if (availableCollectors.length === 0) {
    return (
      <NeuCard className="text-text-secondary py-6 text-center text-sm">
        수집기 설정이 없습니다
      </NeuCard>
    )
  }

  return (
    <div className="space-y-4">
      {availableCollectors.map((ct) => {
        const ctGroups = getGroupsForCt(ct)
        const ctLiveSummary = liveSummaryByCt[ct] ?? {}
        const ctConfiguredGroups = collectorConfigs
          .filter((c) => c.collector_type === ct && c.enabled)
          .map((c) => c.metric_group)

        return (
          <div key={ct} className="space-y-2">
            <h3 className="text-text-secondary text-xs font-semibold tracking-wide uppercase">
              {COLLECTOR_SECTION_LABELS[ct] ?? ct}
            </h3>
            {ctGroups.length === 0 ? (
              <p className="text-text-secondary text-xs">수집 항목 없음</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ctGroups.map((group) => {
                  const isGroupConfigured = ctConfiguredGroups.includes(group)
                  const liveValue = ctLiveSummary[group]
                  const { status, avg } = getMetricStatus(
                    liveValue,
                    isSystemLive,
                    ct,
                    group,
                    isGroupConfigured,
                  )
                  const cfg = STATUS_CFG[status]
                  const lineColor = (SPARK_LINE_COLOR[status] ?? SPARK_LINE_COLOR.normal)[theme]
                  const key = `${ct}::${group}`
                  const queryIdx = sparkIndexByKey.get(key) ?? -1
                  const isSparkLoading =
                    queryIdx >= 0 ? (queries[queryIdx]?.isLoading ?? false) : false

                  return (
                    <div
                      key={group}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenChart(group, ct)}
                      onKeyDown={(e) => e.key === 'Enter' && onOpenChart(group, ct)}
                      className="group bg-bg-base shadow-neu-flat hover:bg-surface focus-visible:ring-accent cursor-pointer rounded-sm p-3 transition-[transform,background-color] duration-150 focus-visible:ring-1 focus-visible:outline-none active:scale-[0.98]"
                    >
                      {/* 헤더: 그룹명 + 상태 배지 */}
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-text-secondary flex min-w-0 items-center text-xs font-medium">
                          {CHART_TITLES[group] ?? group}
                          {METRIC_HINTS[group] && <InfoTooltip text={METRIC_HINTS[group]} />}
                        </span>
                        <span
                          className={cn(
                            'flex flex-shrink-0 items-center gap-1.5 text-xs font-medium',
                            cfg.color,
                          )}
                        >
                          <span className={cn('text-[8px]', cfg.dot)}>●</span>
                          <span>{cfg.label}</span>
                          {avg !== null && (
                            <span className="font-mono font-semibold">
                              {avg.toFixed(0)}
                              {UNIT_MAP[group] ?? '%'}
                            </span>
                          )}
                          <Maximize2 className="text-text-disabled ml-0.5 h-3 w-3 flex-shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-40" />
                        </span>
                      </div>
                      {/* 미니 스파크라인 */}
                      <div className="h-14">
                        {status === 'inactive' && !isGroupConfigured ? (
                          <div className="flex h-full flex-col items-center justify-center gap-1">
                            <span className="text-text-disabled text-[10px]">수집기 미설정</span>
                            <Link
                              to={ROUTES.AGENTS}
                              onClick={(e) => e.stopPropagation()}
                              className="text-accent hover:text-accent/80 text-[10px] font-medium underline-offset-2 hover:underline"
                            >
                              에이전트 관리 →
                            </Link>
                          </div>
                        ) : (
                          <MiniSparkline
                            data={sparkByKey.get(key) ?? []}
                            metricKey={CARD_METRIC_KEY[group]}
                            lineColor={lineColor}
                            isLoading={isSparkLoading}
                            sparkId={key}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function MetricChartPopup({
  chartPopup,
  popupClosing,
  timeRange,
  adaptiveStep,
  minuteData,
  minuteLoading,
  onClose,
}: ChartPopupProps) {
  const theme = useUiStore((s) => s.theme)
  const gridColor = theme === 'dark' ? '#2B2F37' : '#D1D5DB'
  const tickColor = theme === 'dark' ? '#8B97AD' : '#6B7280'

  // 인스턴스 뷰 / 시스템 집계 뷰 전환
  const [showAggregate, setShowAggregate] = useState(false)
  // 인스턴스 라인 개별 토글
  const [hiddenInstances, setHiddenInstances] = useState<Set<string>>(new Set())

  // 팝업이 다른 그룹으로 바뀌면 상태 초기화
  const groupKey = chartPopup.group
  const [lastGroup, setLastGroup] = useState(groupKey)
  if (lastGroup !== groupKey) {
    setLastGroup(groupKey)
    setShowAggregate(false)
    setHiddenInstances(new Set())
  }

  const metricBase = INST_METRIC_BASE[chartPopup.group]

  // 인스턴스별 차트 데이터 피벗 (인스턴스 데이터가 있으면 항상 계산)
  const instanceChartData = useMemo(() => {
    if (!metricBase || minuteData.length === 0) return null
    const series = extractInstanceSeries(minuteData, metricBase)
    if (series.length === 0) return null

    const timeMap = new Map<string, Record<string, string | number | null>>()
    for (const { instance_role, values } of series) {
      for (const { ts, value } of values) {
        let row = timeMap.get(ts)
        if (!row) {
          row = { timestamp: ts }
          timeMap.set(ts, row)
        }
        row[instance_role] = value
      }
    }
    return {
      data: Array.from(timeMap.values()).sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp)),
      ),
      instances: series.map((s) => s.instance_role),
      latestValues: Object.fromEntries(
        series.map((s) => [s.instance_role, getLatestValue(s.values)]),
      ),
    }
  }, [minuteData, metricBase])

  const unit = UNIT_MAP[chartPopup.group]

  return (
    <div
      className={`bg-overlay-heavy fixed inset-0 z-50 flex items-center justify-center p-4 ${
        popupClosing ? 'popup-overlay-exit' : 'popup-overlay-enter'
      }`}
      onClick={onClose}
    >
      <div
        className={`bg-bg-base shadow-neu-flat w-full max-w-2xl rounded-sm p-5 ${
          popupClosing ? 'popup-content-exit' : 'popup-content-enter'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 팝업 헤더 */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold">
              {CHART_TITLES[chartPopup.group] ?? chartPopup.group}
              {unit && (
                <span className="text-text-secondary ml-1 text-sm font-normal">({unit})</span>
              )}
            </h3>
            <p className="text-text-secondary mt-0.5 text-xs">
              최근 {timeRange} 추이 ·{' '}
              {adaptiveStep < 60 ? `${adaptiveStep}초` : `${adaptiveStep / 60}분`} 간격
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {/* 인스턴스 데이터가 있을 때만 뷰 전환 토글 표시 */}
            {instanceChartData && (
              <div className="bg-bg-base shadow-neu-pressed flex gap-1 rounded-sm p-1">
                {(['인스턴스', '시스템 집계'] as const).map((label, idx) => {
                  const isActive = showAggregate ? idx === 1 : idx === 0
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setShowAggregate(idx === 1)}
                      className={cn(
                        'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
                        isActive
                          ? 'bg-accent text-accent-contrast shadow-neu-flat font-semibold'
                          : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
            <button
              onClick={onClose}
              className="text-text-secondary hover:bg-hover-subtle hover:text-text-primary rounded-sm p-1 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 차트 */}
        {minuteLoading ? (
          <div className="text-text-secondary py-10 text-center text-sm">로딩 중...</div>
        ) : minuteData.length === 0 ? (
          <div className="text-text-secondary py-10 text-center text-sm">
            수집된 데이터가 없습니다.
            <br />
            에이전트가 Prometheus에 데이터를 전송 중인지 확인하세요.
          </div>
        ) : !showAggregate && instanceChartData ? (
          /* 인스턴스 뷰 (기본): 시맨틱 색상 멀티라인 */
          <div className="bg-bg-base shadow-neu-flat rounded-sm p-4">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={instanceChartData.data}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fontSize: 11, fill: tickColor }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                  angle={-35}
                  textAnchor="end"
                  height={44}
                  tickMargin={8}
                />
                <YAxis tick={{ fontSize: 11, fill: tickColor }} unit={unit} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-base)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '2px',
                    fontSize: '11px',
                  }}
                />
                {instanceChartData.instances.map((role) => (
                  <Line
                    key={role}
                    name={role}
                    type="monotone"
                    dataKey={role}
                    stroke={resolveInstColor(
                      instanceChartData.latestValues[role],
                      chartPopup.collectorType,
                      chartPopup.group,
                      theme,
                    )}
                    dot={false}
                    strokeWidth={1.5}
                    connectNulls={false}
                    hide={hiddenInstances.has(role)}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
            {/* 클릭 토글 범례 — 시스템 집계와 동일하게 박스 안에 배치 */}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              {instanceChartData.instances.map((role) => {
                const color = resolveInstColor(
                  instanceChartData.latestValues[role],
                  chartPopup.collectorType,
                  chartPopup.group,
                  theme,
                )
                const hidden = hiddenInstances.has(role)
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() =>
                      setHiddenInstances((prev) => {
                        const next = new Set(prev)
                        if (next.has(role)) next.delete(role)
                        else next.add(role)
                        return next
                      })
                    }
                    className="flex items-center gap-1.5 py-0.5 transition-opacity"
                    style={{ opacity: hidden ? 0.4 : 1 }}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full transition-colors"
                      style={{ backgroundColor: hidden ? INST_MUTED_COLOR[theme] : color }}
                    />
                    <span
                      className="text-text-secondary text-[11px]"
                      style={{ opacity: hidden ? 0.5 : 1 }}
                    >
                      {role}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          /* 시스템 집계 뷰: 서브메트릭 차트 (CPU는 max만 기본 표시) */
          <MetricChart
            aggregations={minuteData}
            metricKeys={getMetricKeys(
              chartPopup.collectorType,
              chartPopup.group,
              minuteData[0]?.metrics_json,
            )}
            title=""
            unit={unit}
            defaultHiddenKeys={DEFAULT_HIDDEN_KEYS_BY_GROUP[chartPopup.group]}
          />
        )}
      </div>
    </div>
  )
}
