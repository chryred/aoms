import { useState, useCallback } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { HourlyAggregation } from '@/types/aggregation'
import { transformToChartData } from '@/lib/metrics-transform'

interface MetricChartProps {
  aggregations: HourlyAggregation[]
  metricKeys: string[]
  title: string
  unit?: string
  onPointClick?: (hourBucket: string) => void
}

const LINE_COLORS = ['#00D4FF', '#22C55E', '#F59E0B', '#EC4899', '#14B8A6']

// 특정 키에 대한 색상 고정 오버라이드 (LINE_COLORS 순서에 관계없이 항상 이 색상 사용)
const KEY_COLOR_OVERRIDE: Record<string, string> = {
  net_max_mbps: '#EF4444',
}

const KEY_LABELS: Record<string, string> = {
  cpu_avg: '평균',
  cpu_max: '최대',
  cpu_p95: 'P95',
  load1: '부하(1분)',
  load5: '부하(5분)',
  mem_used_pct: '사용률',
  mem_p95: 'P95',
  disk_read_mb: '읽기',
  disk_write_mb: '쓰기',
  disk_io_ms: 'I/O 지연',
  net_rx_mb: '수신',
  net_tx_mb: '송신',
  net_max_mbps: '최대 대역폭',
  log_errors: '오류',
  log_errors_err: 'ERROR',
  req_total: '요청',
  req_slow: '지연 요청',
  resp_avg_ms: '응답시간',
  conn_active_pct: '활성 커넥션',
  conn_max: '최대 커넥션',
  tps: 'TPS',
  slow_queries: '슬로우쿼리',
  cache_hit_rate: '캐시 적중률',
  repl_lag_sec: '복제 지연',
}

interface TooltipPayloadEntry {
  name: string
  value: number | string
  color: string
  payload?: Record<string, unknown>
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const raw = payload[0]?.payload ?? {}
  const severity = raw.llm_severity as string | undefined
  const summary = raw.llm_summary as string | undefined
  const prediction = raw.llm_prediction as string | undefined
  return (
    <div className="max-w-xs rounded-sm border border-[#2B2F37] bg-[#1E2127] p-3 text-xs shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
      <p className="mb-1 font-semibold text-[#E2E8F2]">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
      {severity && severity !== 'normal' && (
        <p
          className={`mt-1 font-medium ${severity === 'critical' ? 'text-[#EF4444]' : 'text-[#F59E0B]'}`}
        >
          {severity === 'critical' ? '위험' : '경고'}
        </p>
      )}
      {summary && <p className="mt-1 whitespace-pre-wrap text-[#8B97AD]">{summary}</p>}
      {prediction && <p className="mt-1 text-[#00D4FF] italic">{prediction}</p>}
    </div>
  )
}

export function MetricChart({
  aggregations,
  metricKeys,
  title,
  unit,
  onPointClick,
}: MetricChartProps) {
  const data = transformToChartData(aggregations, metricKeys)

  // 숨긴 범례 키 관리 — 기본은 전부 표시
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set())

  const toggleKey = useCallback((key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const warningPoints = aggregations
    .filter((a) => a.llm_severity === 'warning')
    .map((a) => {
      const d = new Date(a.hour_bucket)
      return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)
    })
  const criticalPoints = aggregations
    .filter((a) => a.llm_severity === 'critical')
    .map((a) => {
      const d = new Date(a.hour_bucket)
      return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)
    })

  return (
    <div className="rounded-sm bg-[#1E2127] p-4 shadow-[3px_3px_7px_#111317,-3px_-3px_7px_#2B2F37]">
      <h3 className="mb-3 text-sm font-semibold text-[#E2E8F2]">
        {title}
        {unit && ` (${unit})`}
      </h3>
      {data.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-[#8B97AD]">
          데이터 없음
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart
              data={data}
              onClick={(e) => {
                if (onPointClick && e?.activePayload?.[0]) {
                  const idx = data.indexOf(e.activePayload[0].payload)
                  if (idx >= 0) onPointClick(aggregations[idx]?.hour_bucket ?? '')
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2B2F37" />
              <XAxis dataKey="timestamp" tick={{ fontSize: 11, fill: '#8B97AD' }} />
              <YAxis tick={{ fontSize: 11, fill: '#8B97AD' }} unit={unit} />
              <Tooltip content={<CustomTooltip />} />
              {metricKeys.map((key, i) => (
                <Line
                  key={key}
                  name={KEY_LABELS[key] ?? key}
                  type="monotone"
                  dataKey={key}
                  stroke={KEY_COLOR_OVERRIDE[key] ?? LINE_COLORS[i % LINE_COLORS.length]}
                  strokeDasharray={
                    key in KEY_COLOR_OVERRIDE ? '6 3' : key.includes('max') ? '5 5' : undefined
                  }
                  dot={false}
                  strokeWidth={1.5}
                  hide={hiddenKeys.has(key)}
                />
              ))}
              {warningPoints.map((ts) => (
                <ReferenceLine key={`w-${ts}`} x={ts} stroke="#F59E0B" strokeDasharray="4 2" />
              ))}
              {criticalPoints.map((ts) => (
                <ReferenceLine key={`c-${ts}`} x={ts} stroke="#EF4444" strokeDasharray="4 2" />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

          {/* 인터랙티브 범례 */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {metricKeys.map((key, i) => {
              const color = KEY_COLOR_OVERRIDE[key] ?? LINE_COLORS[i % LINE_COLORS.length]
              const hidden = hiddenKeys.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleKey(key)}
                  className="flex items-center gap-1.5 py-0.5 transition-opacity"
                  style={{ opacity: hidden ? 0.4 : 1 }}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full transition-colors"
                    style={{ backgroundColor: hidden ? '#555' : color }}
                  />
                  <span
                    className="text-[11px] transition-colors"
                    style={{ color: hidden ? '#555' : '#8B97AD' }}
                  >
                    {KEY_LABELS[key] ?? key}
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
