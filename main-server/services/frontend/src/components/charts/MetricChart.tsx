import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer
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

const LINE_COLORS = ['#6366F1', '#22C55E', '#F59E0B', '#EC4899', '#14B8A6']

interface TooltipPayloadEntry {
  name: string
  value: number | string
  color: string
  payload?: Record<string, unknown>
}

function CustomTooltip({ active, payload, label }: {
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
    <div className="rounded-xl bg-white border border-[#C0C4CF] p-3 shadow-lg text-xs max-w-xs">
      <p className="font-semibold text-[#1A1F2E] mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value}</p>
      ))}
      {severity && severity !== 'normal' && (
        <p className={`mt-1 font-medium ${severity === 'critical' ? 'text-[#DC2626]' : 'text-[#D97706]'}`}>
          {severity === 'critical' ? '위험' : '경고'}
        </p>
      )}
      {summary && <p className="mt-1 text-[#4A5568] whitespace-pre-wrap">{summary}</p>}
      {prediction && <p className="mt-1 text-[#6366F1] italic">{prediction}</p>}
    </div>
  )
}

export function MetricChart({ aggregations, metricKeys, title, unit, onPointClick }: MetricChartProps) {
  const data = transformToChartData(aggregations, metricKeys)

  const warningPoints = aggregations
    .filter(a => a.llm_severity === 'warning')
    .map(a => {
      const d = new Date(a.hour_bucket)
      return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)
    })
  const criticalPoints = aggregations
    .filter(a => a.llm_severity === 'critical')
    .map(a => {
      const d = new Date(a.hour_bucket)
      return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)
    })

  return (
    <div className="rounded-2xl bg-[#E8EBF0] p-4 shadow-[6px_6px_12px_#C8CBD4,-6px_-6px_12px_#FFFFFF]">
      <h3 className="text-sm font-semibold text-[#1A1F2E] mb-3">{title}{unit && ` (${unit})`}</h3>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-sm text-[#4A5568]">데이터 없음</div>
      ) : (
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
            <CartesianGrid strokeDasharray="3 3" stroke="#C8CBD4" />
            <XAxis dataKey="timestamp" tick={{ fontSize: 11, fill: '#4A5568' }} />
            <YAxis tick={{ fontSize: 11, fill: '#4A5568' }} unit={unit} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {metricKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                strokeDasharray={key.includes('max') ? '5 5' : undefined}
                dot={false}
                strokeWidth={1.5}
              />
            ))}
            {warningPoints.map(ts => (
              <ReferenceLine key={`w-${ts}`} x={ts} stroke="#D97706" strokeDasharray="4 2" />
            ))}
            {criticalPoints.map(ts => (
              <ReferenceLine key={`c-${ts}`} x={ts} stroke="#DC2626" strokeDasharray="4 2" />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
