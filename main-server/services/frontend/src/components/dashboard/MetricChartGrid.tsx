import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { MetricChart } from '@/components/charts/MetricChart'
import { getMetricKeys, extractInstanceSeries } from '@/lib/metrics-transform'
import {
  COLLECTOR_SECTION_LABELS,
  CHART_TITLES,
  UNIT_MAP,
  DEFAULT_HIDDEN_KEYS_BY_GROUP,
} from '@/lib/metrics-config'
import { cn } from '@/lib/utils'
import { getMetricStatus, classifyByValue, STATUS_CFG } from '@/hooks/useMetricDashboard'
import { useUiStore } from '@/store/uiStore'
import type { TimeRange } from '@/hooks/useMetricDashboard'
import type { HourlyAggregation } from '@/types/aggregation'

// 시맨틱 색상 쌍 (임계치 초과 시만 색상 부여, 정상·미등록은 muted)
const INST_WARNING_COLOR = { dark: '#F59E0B', light: '#D97706' }
const INST_CRITICAL_COLOR = { dark: '#EF4444', light: '#DC2626' }
const INST_MUTED_COLOR = { dark: '#8B97AD', light: '#6B7280' }

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

export function MetricChartGrid({
  availableCollectors,
  collectorConfigs,
  liveSummaryByCt,
  isSystemLive,
  getGroupsForCt,
  onOpenChart,
}: MetricChartGridProps) {
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

                  return (
                    <div
                      key={group}
                      onClick={() => onOpenChart(group, ct)}
                      className="bg-bg-base shadow-neu-flat hover:bg-surface flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 transition-[transform,background-color] duration-150 active:scale-[0.98]"
                    >
                      <span className="text-text-tertiary text-xs font-medium">
                        {CHART_TITLES[group] ?? group}
                      </span>
                      <span
                        className={cn('flex items-center gap-1 text-xs font-medium', cfg.color)}
                      >
                        <span className={cn('text-[8px]', cfg.dot)}>●</span>
                        {cfg.label}
                        {avg !== null && (
                          <span className="font-mono text-[10px] opacity-80">
                            ({avg.toFixed(0)}%)
                          </span>
                        )}
                      </span>
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
