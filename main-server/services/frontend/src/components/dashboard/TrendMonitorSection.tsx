import { useState, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { TrendingUp, Clock } from 'lucide-react'
import { aggregationsApi } from '@/api/aggregations'
import { NeuMultiSelect } from '@/components/neumorphic/NeuMultiSelect'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { useUiStore } from '@/store/uiStore'
import { formatKST } from '@/lib/utils'
import type { SystemHealthData } from '@/hooks/queries/useDashboardHealth'
import type { HourlyAggregation } from '@/types/aggregation'

interface TrendMonitorSectionProps {
  systems: SystemHealthData[]
}

const TREND_CHARTS = [
  {
    title: 'CPU 사용률',
    collectorType: 'synapse_agent',
    metricGroup: 'cpu',
    metricKey: 'cpu_avg',
    unit: '%',
  },
  {
    title: '메모리 사용률',
    collectorType: 'synapse_agent',
    metricGroup: 'memory',
    metricKey: 'mem_used_pct',
    unit: '%',
  },
  {
    title: '로그 에러 추이',
    collectorType: 'synapse_agent',
    metricGroup: 'log',
    metricKey: 'log_errors',
    unit: '건',
  },
  {
    title: '웹 응답시간',
    collectorType: 'synapse_agent',
    metricGroup: 'web',
    metricKey: 'resp_avg_ms',
    unit: 'ms',
  },
] as const

const LINE_COLORS_DARK = ['#00D4FF', '#22C55E', '#F59E0B', '#EC4899', '#14B8A6']
const LINE_COLORS_LIGHT = ['#0891B2', '#059669', '#D97706', '#DB2777', '#0D9488']

const HOURS = 6
const STEP = 300

interface TrendDataPoint {
  timestamp: string
  [systemName: string]: number | string | undefined
}

interface TrendTooltipEntry {
  name: string
  value: number | string
  color: string
}

function TrendTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: TrendTooltipEntry[]
  label?: string
  unit?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="border-border bg-bg-base shadow-neu-flat max-w-xs rounded-sm border p-3 text-xs">
      <p className="text-text-primary mb-1 font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          {unit ? ` ${unit}` : ''}
        </p>
      ))}
    </div>
  )
}

function TrendChart({
  data,
  systemNames,
  title,
  unit,
}: {
  data: TrendDataPoint[]
  systemNames: string[]
  title: string
  unit: string
}) {
  const theme = useUiStore((s) => s.theme)
  const lineColors = theme === 'dark' ? LINE_COLORS_DARK : LINE_COLORS_LIGHT
  const gridColor = theme === 'dark' ? '#2B2F37' : '#E5E7EB'
  const tickColor = theme === 'dark' ? '#8B97AD' : '#6B7280'
  const showLegend = systemNames.length > 1

  return (
    <div className="bg-bg-base shadow-neu-flat rounded-sm p-4">
      <h3 className="text-text-primary mb-3 text-sm font-semibold">
        {title}
        {unit && ` (${unit})`}
      </h3>
      {data.length === 0 ? (
        <div className="flex h-36 flex-col items-center justify-center gap-1 text-center">
          <span className="text-text-secondary text-sm">수집된 데이터 없음</span>
          <span className="text-text-disabled text-xs leading-relaxed">
            선택된 시스템에 해당 수집기가
            <br />
            구성되지 않았을 수 있습니다
          </span>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="timestamp" tick={{ fontSize: 11, fill: tickColor }} />
              <YAxis tick={{ fontSize: 11, fill: tickColor }} unit={unit} />
              <Tooltip content={<TrendTooltip unit={unit} />} />
              {systemNames.map((name, i) => (
                <Line
                  key={name}
                  name={name}
                  type="monotone"
                  dataKey={name}
                  stroke={lineColors[i % lineColors.length]}
                  dot={false}
                  strokeWidth={1.5}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          {showLegend && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              {systemNames.map((name, i) => (
                <div key={name} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: lineColors[i % lineColors.length] }}
                  />
                  <span className="text-text-secondary text-[11px]">{name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function TrendMonitorSection({ systems }: TrendMonitorSectionProps) {
  const [selectedSystems, setSelectedSystems] = useState<(string | number)[]>([])

  const isAllSelected = selectedSystems.length === 0

  const targetSystemIds = useMemo(() => {
    if (isAllSelected) return systems.map((s) => Number(s.system_id))
    return selectedSystems.map(Number)
  }, [isAllSelected, selectedSystems, systems])

  const systemNameMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const s of systems) map.set(Number(s.system_id), s.display_name)
    return map
  }, [systems])

  const { startDt, endDt } = useMemo(() => {
    const now = new Date()
    return {
      startDt: new Date(now.getTime() - HOURS * 3_600_000).toISOString(),
      endDt: now.toISOString(),
    }
  }, [])

  const queries = useQueries({
    queries: targetSystemIds.flatMap((sysId) =>
      TREND_CHARTS.map((chart) => ({
        queryKey: ['metrics-range-trend', sysId, chart.metricGroup, startDt],
        queryFn: () =>
          aggregationsApi.getMetricsRange({
            system_id: sysId,
            collector_type: chart.collectorType,
            metric_group: chart.metricGroup,
            start_dt: startDt,
            end_dt: endDt,
            step: STEP,
          }),
        staleTime: 300_000,
        gcTime: 600_000,
      })),
    ),
  })

  const isLoading = queries.some((q) => q.isLoading)

  // 시스템별 데이터를 metric_group별로 정리
  const perSystemData = useMemo(() => {
    const result = new Map<string, Map<number, HourlyAggregation[]>>()
    for (const chart of TREND_CHARTS) {
      result.set(chart.metricGroup, new Map())
    }
    for (let i = 0; i < targetSystemIds.length; i++) {
      for (let j = 0; j < TREND_CHARTS.length; j++) {
        const queryIdx = i * TREND_CHARTS.length + j
        const data = queries[queryIdx]?.data
        if (data?.length) {
          result.get(TREND_CHARTS[j].metricGroup)!.set(targetSystemIds[i], data)
        }
      }
    }
    return result
  }, [queries, targetSystemIds])

  const buildChartData = (
    metricGroup: string,
    metricKey: string,
  ): { data: TrendDataPoint[]; systemNames: string[] } => {
    const groupData = perSystemData.get(metricGroup)
    if (!groupData || groupData.size === 0) return { data: [], systemNames: [] }

    const systemNames: string[] = []
    const timeMap = new Map<string, TrendDataPoint>()

    for (const [sysId, aggs] of groupData) {
      const name = systemNameMap.get(sysId) ?? `시스템 ${sysId}`
      systemNames.push(name)
      for (const agg of aggs) {
        const ts = formatKST(agg.hour_bucket, 'HH:mm')
        let point = timeMap.get(ts)
        if (!point) {
          point = { timestamp: ts }
          timeMap.set(ts, point)
        }
        const parsed = JSON.parse(agg.metrics_json) as Record<string, number>
        if (typeof parsed[metricKey] === 'number') {
          point[name] = parsed[metricKey]
        }
      }
    }

    const data = Array.from(timeMap.values()).sort((a, b) =>
      (a.timestamp as string).localeCompare(b.timestamp as string),
    )
    return { data, systemNames }
  }

  const selectOptions = useMemo(
    () =>
      systems.map((s) => ({
        value: s.system_id,
        label: s.display_name,
      })),
    [systems],
  )

  const conditionLabel = useMemo(() => {
    if (isAllSelected) return '전체 시스템'
    return selectedSystems
      .map((id) => systems.find((s) => String(s.system_id) === String(id))?.display_name ?? id)
      .join(', ')
  }, [isAllSelected, selectedSystems, systems])

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-text-primary flex items-center gap-2 text-lg font-semibold">
          <TrendingUp className="h-5 w-5" />
          추이 모니터
        </h2>
        <NeuMultiSelect
          options={selectOptions}
          selected={selectedSystems}
          onChange={setSelectedSystems}
          placeholder="시스템 선택..."
          className="w-full sm:w-56"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <Clock className="text-text-disabled h-3 w-3 flex-shrink-0" />
        <span className="text-text-disabled text-xs">
          최근 {HOURS}시간 · {isAllSelected ? '전체 시스템' : conditionLabel}
        </span>
      </div>

      {isLoading ? (
        <LoadingSkeleton shape="card" count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {TREND_CHARTS.map((chart) => {
            const { data, systemNames } = buildChartData(chart.metricGroup, chart.metricKey)
            return (
              <TrendChart
                key={chart.metricGroup}
                data={data}
                systemNames={systemNames}
                title={chart.title}
                unit={chart.unit}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
