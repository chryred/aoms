import { X } from 'lucide-react'
import { NeuCard } from '@/components/neumorphic/NeuCard'
import { MetricChart } from '@/components/charts/MetricChart'
import { getMetricKeys } from '@/lib/metrics-transform'
import { COLLECTOR_SECTION_LABELS, CHART_TITLES, UNIT_MAP } from '@/lib/metrics-config'
import { cn } from '@/lib/utils'
import { getMetricStatus, STATUS_CFG } from '@/hooks/useMetricDashboard'
import type { TimeRange } from '@/hooks/useMetricDashboard'
import type { HourlyAggregation } from '@/types/aggregation'

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
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-text-primary font-semibold">
              {CHART_TITLES[chartPopup.group] ?? chartPopup.group}
              {UNIT_MAP[chartPopup.group] && (
                <span className="text-text-secondary ml-1 text-sm font-normal">
                  ({UNIT_MAP[chartPopup.group]})
                </span>
              )}
            </h3>
            <p className="text-text-secondary mt-0.5 text-xs">
              최근 {timeRange} 추이 ·{' '}
              {adaptiveStep < 60 ? `${adaptiveStep}초` : `${adaptiveStep / 60}분`} 간격
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:bg-hover-subtle hover:text-text-primary rounded-sm p-1 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
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
        ) : (
          <MetricChart
            aggregations={minuteData}
            metricKeys={getMetricKeys(
              chartPopup.collectorType,
              chartPopup.group,
              minuteData[0]?.metrics_json,
            )}
            title=""
            unit={UNIT_MAP[chartPopup.group]}
          />
        )}
      </div>
    </div>
  )
}
