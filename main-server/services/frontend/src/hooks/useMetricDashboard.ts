import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  useHourlyAggregations,
  useCollectorConfigs,
  useMetricsRange,
  useMetricsLiveSummary,
  useProcessSummary,
} from '@/hooks/queries/useAggregations'
import { useSystemLiveStatus, useAgents } from '@/hooks/queries/useAgents'
import { GROUP_ORDER } from '@/lib/metrics-config'

export type TimeRange = '6h' | '12h' | '24h' | '48h'
export const HOURS_MAP: Record<TimeRange, number> = { '6h': 6, '12h': 12, '24h': 24, '48h': 48 }

export type MetricStatus = 'inactive' | 'collecting' | 'normal' | 'warning' | 'critical'

export const STATUS_CFG: Record<MetricStatus, { label: string; color: string; dot: string }> = {
  inactive: { label: '미수집', color: 'text-text-secondary', dot: 'text-text-secondary' },
  collecting: { label: '수집 중', color: 'text-normal', dot: 'text-normal' },
  normal: { label: '정상', color: 'text-normal', dot: 'text-normal' },
  warning: { label: '경고', color: 'text-warning', dot: 'text-warning' },
  critical: { label: '위험', color: 'text-critical', dot: 'text-critical' },
}

/**
 * 수치 상태 판정 방향:
 *  high_bad — 높을수록 나쁨 (cpu, memory, db_connections)
 *  low_bad  — 낮을수록 나쁨 (db_cache: 캐시 적중률)
 */
const STATUS_BY_VALUE: Record<string, Record<string, 'high_bad' | 'low_bad'>> = {
  synapse_agent: { cpu: 'high_bad', memory: 'high_bad' },
  db_exporter: { db_connections: 'high_bad', db_cache: 'low_bad' },
}

/**
 * Prometheus live-summary 값을 기반으로 카드 상태 판정.
 *
 * liveValue === null      : API가 이 그룹을 쿼리했으나 Prometheus에 데이터 없음 → "미수집"
 * liveValue === undefined : PCT_PROMQL에 없는 그룹 → collector_config 등록 여부로 판단
 * liveValue === number    : 데이터 있음 → 수치로 상태 판정
 */
export function getMetricStatus(
  liveValue: number | null | undefined,
  isSystemLive: boolean,
  collectorType: string,
  group: string,
  isGroupConfigured: boolean,
): { status: MetricStatus; avg: number | null } {
  if (!isSystemLive) return { status: 'inactive', avg: null }

  if (liveValue === null) {
    return { status: 'inactive', avg: null }
  }

  if (liveValue === undefined) {
    return { status: isGroupConfigured ? 'collecting' : 'inactive', avg: null }
  }

  const direction = STATUS_BY_VALUE[collectorType]?.[group]
  if (!direction) return { status: 'collecting', avg: null }

  if (direction === 'high_bad') {
    if (liveValue <= 60) return { status: 'normal', avg: liveValue }
    if (liveValue <= 80) return { status: 'warning', avg: liveValue }
    return { status: 'critical', avg: liveValue }
  } else {
    if (liveValue >= 95) return { status: 'normal', avg: liveValue }
    if (liveValue >= 80) return { status: 'warning', avg: liveValue }
    return { status: 'critical', avg: liveValue }
  }
}

const COLLECTOR_ORDER = ['synapse_agent', 'db_exporter']

export function useMetricDashboard(numericId: number, timeRange: TimeRange) {
  const [chartPopup, setChartPopup] = useState<{ group: string; collectorType: string } | null>(
    null,
  )
  const [popupClosing, setPopupClosing] = useState(false)

  const closeChartPopup = useCallback(() => {
    setPopupClosing(true)
  }, [])

  useEffect(() => {
    if (!popupClosing) return
    const timer = setTimeout(() => {
      setChartPopup(null)
      setPopupClosing(false)
    }, 280)
    return () => clearTimeout(timer)
  }, [popupClosing])

  const { fromDt, toDt, adaptiveStep } = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - HOURS_MAP[timeRange] * 3_600_000)
    const step = Math.max(60, Math.round((HOURS_MAP[timeRange] * 3600) / 480))
    return { fromDt: from.toISOString(), toDt: to.toISOString(), adaptiveStep: step }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, chartPopup])

  const { data: hourly = [] } = useHourlyAggregations({
    system_id: numericId,
    from_dt: fromDt,
    to_dt: toDt,
  })
  const { data: collectorConfigs = [] } = useCollectorConfigs(numericId || undefined)
  const { data: systemLive } = useSystemLiveStatus(numericId || undefined)
  const isSystemLive = systemLive?.is_live ?? false

  const { data: otelAgents = [] } = useAgents({
    system_id: numericId || undefined,
    agent_type: 'otel_javaagent',
  })
  const hasOtel = otelAgents.some((a) => ['running', 'installed'].includes(a.status))

  const { data: minuteData = [], isLoading: minuteLoading } = useMetricsRange(
    chartPopup
      ? {
          system_id: numericId,
          collector_type: chartPopup.collectorType,
          metric_group: chartPopup.group,
          start_dt: fromDt,
          end_dt: toDt,
          step: adaptiveStep,
        }
      : null,
  )

  const { data: synapseAgentLiveSummary = {} } = useMetricsLiveSummary(
    numericId || null,
    'synapse_agent',
  )
  const { data: dbExporterLiveSummary = {} } = useMetricsLiveSummary(
    numericId || null,
    'db_exporter',
  )
  const { data: processSummary = [] } = useProcessSummary(numericId || null)

  const liveSummaryByCt: Record<string, Record<string, number | null>> = {
    synapse_agent: synapseAgentLiveSummary as Record<string, number | null>,
    db_exporter: dbExporterLiveSummary as Record<string, number | null>,
  }

  const configuredCollectors = [...new Set(collectorConfigs.map((c) => c.collector_type))]
  const hourlyCollectors = [...new Set(hourly.map((a) => a.collector_type))]
  const liveCollectors = Object.entries(liveSummaryByCt)
    .filter(([, groups]) => Object.keys(groups).length > 0)
    .map(([ct]) => ct)
  const availableCollectors = [
    ...new Set([...configuredCollectors, ...hourlyCollectors, ...liveCollectors]),
  ].sort((a, b) => {
    const ai = COLLECTOR_ORDER.indexOf(a)
    const bi = COLLECTOR_ORDER.indexOf(b)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  function getGroupsForCt(ct: string): string[] {
    const configured = collectorConfigs
      .filter((c) => c.collector_type === ct && c.enabled)
      .map((c) => c.metric_group)
    const fromHourly = hourly.filter((a) => a.collector_type === ct).map((a) => a.metric_group)
    const fromLive = Object.keys(liveSummaryByCt[ct] ?? {})
    return [...new Set([...configured, ...fromHourly, ...fromLive])].sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a)
      const bi = GROUP_ORDER.indexOf(b)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
  }

  return {
    chartPopup,
    setChartPopup,
    popupClosing,
    closeChartPopup,
    fromDt,
    toDt,
    adaptiveStep,
    isSystemLive,
    hasOtel,
    minuteData,
    minuteLoading,
    processSummary,
    availableCollectors,
    collectorConfigs,
    liveSummaryByCt,
    getGroupsForCt,
  }
}
