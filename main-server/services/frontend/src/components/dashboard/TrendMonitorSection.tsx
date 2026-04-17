import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
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
import { Clock } from 'lucide-react'
import { aggregationsApi } from '@/api/aggregations'
import { NeuMultiSelect } from '@/components/neumorphic/NeuMultiSelect'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { useUiStore } from '@/store/uiStore'
import { formatKST, cn } from '@/lib/utils'
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
const EXPAND_DURATION = 340
const COLLAPSE_DURATION = 280

interface TrendDataPoint {
  timestamp: string
  [systemName: string]: number | string | undefined
}

interface TrendTooltipEntry {
  name: string
  value: number | string
  color: string
}

interface ExpandRects {
  from: DOMRect
  to: DOMRect
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

// FLIP 확대 패널 — content 영역(main)의 bounds로 자연스럽게 팽창
function ExpandedPanel({
  rects,
  isClosing,
  title,
  unit,
  lineColors,
  gridColor,
  tickColor,
  data,
  systemNames,
  showLegend,
  onClose,
}: {
  rects: ExpandRects
  isClosing: boolean
  title: string
  unit: string
  lineColors: string[]
  gridColor: string
  tickColor: string
  data: TrendDataPoint[]
  systemNames: string[]
  showLegend: boolean
  onClose: () => void
}) {
  // FLIP: 처음엔 카드 위치에서 시작 → 다음 프레임에 transform 제거로 content 영역까지 팽창
  const [played, setPlayed] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPlayed(true))
    })
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const { from, to } = rects
  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / to.width
  const sy = from.height / to.height

  // 닫힐 때: 다시 카드 위치로 역방향 FLIP
  const atCardPos = !played || isClosing

  const panelStyle: CSSProperties = {
    position: 'fixed',
    top: to.top,
    left: to.left,
    width: to.width,
    height: to.height,
    transformOrigin: 'top left',
    transform: atCardPos ? `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` : 'none',
    transition: played
      ? `transform ${isClosing ? COLLAPSE_DURATION : EXPAND_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`
      : 'none',
    zIndex: 40,
    overflow: 'hidden',
  }

  return (
    <div style={panelStyle} className="bg-bg-base" onDoubleClick={onClose}>
      <div className="flex h-full flex-col p-5">
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="type-heading text-text-primary text-base font-semibold">
            {title}
            {unit && ` (${unit})`}
          </h3>
          <span className="text-text-disabled cursor-zoom-out select-none text-[10px]">
            더블클릭 또는 ESC로 닫기
          </span>
        </div>

        {data.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
            <span className="text-text-secondary text-sm">수집된 데이터 없음</span>
            <span className="text-text-disabled text-xs leading-relaxed">
              선택된 시스템에 해당 수집기가
              <br />
              구성되지 않았을 수 있습니다
            </span>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="timestamp" tick={{ fontSize: 12, fill: tickColor }} />
                  <YAxis tick={{ fontSize: 12, fill: tickColor }} unit={unit} />
                  <Tooltip content={<TrendTooltip unit={unit} />} />
                  {systemNames.map((name, i) => (
                    <Line
                      key={name}
                      name={name}
                      type="monotone"
                      dataKey={name}
                      stroke={lineColors[i % lineColors.length]}
                      dot={false}
                      strokeWidth={2}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {showLegend && (
              <div className="mt-3 flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1">
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
    </div>
  )
}

function TrendChart({
  data,
  systemNames,
  title,
  unit,
  isExpanded,
  isClosing,
  expandRects,
  onToggle,
}: {
  data: TrendDataPoint[]
  systemNames: string[]
  title: string
  unit: string
  isExpanded: boolean
  isClosing: boolean
  expandRects: ExpandRects | null
  onToggle: (cardEl: HTMLDivElement) => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const theme = useUiStore((s) => s.theme)
  const lineColors = theme === 'dark' ? LINE_COLORS_DARK : LINE_COLORS_LIGHT
  const gridColor = theme === 'dark' ? '#2B2F37' : '#E5E7EB'
  const tickColor = theme === 'dark' ? '#8B97AD' : '#6B7280'
  const showLegend = systemNames.length > 1

  const handleDoubleClick = () => {
    if (cardRef.current) onToggle(cardRef.current)
  }

  return (
    <>
      {/* 일반 카드 — 확대 중엔 투명하게 자리 유지 (레이아웃 점프 방지) */}
      <div
        ref={cardRef}
        className={cn(
          'bg-bg-base shadow-neu-flat rounded-sm p-4 select-none transition-opacity duration-200',
          isExpanded ? 'opacity-0 pointer-events-none' : 'cursor-zoom-in',
        )}
        onDoubleClick={handleDoubleClick}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="type-heading text-text-primary text-sm font-semibold">
            {title}
            {unit && ` (${unit})`}
          </h3>
          <span className="text-text-disabled text-[10px]">더블클릭하여 확대</span>
        </div>

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

      {/* FLIP 확대 패널 — 카드 위치에서 content 영역까지 자연스럽게 팽창 */}
      {isExpanded &&
        expandRects &&
        createPortal(
          <ExpandedPanel
            rects={expandRects}
            isClosing={isClosing}
            title={title}
            unit={unit}
            lineColors={lineColors}
            gridColor={gridColor}
            tickColor={tickColor}
            data={data}
            systemNames={systemNames}
            showLegend={showLegend}
            onClose={handleDoubleClick}
          />,
          document.body,
        )}
    </>
  )
}

export function TrendMonitorSection({ systems }: TrendMonitorSectionProps) {
  const [selectedSystems, setSelectedSystems] = useState<(string | number)[]>([])
  const [expandedChart, setExpandedChart] = useState<string | null>(null)
  const [closingChart, setClosingChart] = useState<string | null>(null)
  const [expandRects, setExpandRects] = useState<ExpandRects | null>(null)

  const handleToggle = useCallback(
    (key: string, cardEl: HTMLDivElement) => {
      if (expandedChart === key) {
        // 역방향 FLIP 시작 후 DOM에서 제거
        setClosingChart(key)
        setTimeout(() => {
          setExpandedChart(null)
          setClosingChart(null)
          setExpandRects(null)
        }, COLLAPSE_DURATION + 40)
        return
      }

      // content 영역(main)의 bounds를 target으로 사용
      const mainEl = document.querySelector('main')
      if (mainEl) {
        setExpandRects({
          from: cardEl.getBoundingClientRect(),
          to: mainEl.getBoundingClientRect(),
        })
      }
      setExpandedChart(key)
      setClosingChart(null)
    },
    [expandedChart],
  )

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
        <h2 className="type-heading text-text-primary text-lg font-semibold">추이 모니터</h2>
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
                isExpanded={expandedChart === chart.metricGroup}
                isClosing={closingChart === chart.metricGroup}
                expandRects={expandedChart === chart.metricGroup ? expandRects : null}
                onToggle={(cardEl) => handleToggle(chart.metricGroup, cardEl)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
