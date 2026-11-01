import type { SeriesPoint } from '@/lib/apm/liveData'

interface Line {
  label: string
  /** CSS 변수 이름 (예: --color-accent) */
  colorVar: string
  points: SeriesPoint[]
}

interface MiniChartProps {
  lines: Line[]
  format?: (v: number) => string
  emptyText?: string
}

const W = 300
const H = 100

/** 의존성 없는 반응형 SVG 라인 차트. 색은 CSS 변수만 사용. */
export function MiniChart({
  lines,
  format = (v) => v.toFixed(1),
  emptyText = '데이터 수집 중',
}: MiniChartProps) {
  const all = lines.flatMap((l) => l.points)
  if (all.length === 0) {
    return (
      <div className="text-text-tertiary flex h-full items-center justify-center text-xs">
        {emptyText}
      </div>
    )
  }
  const tMin = Math.min(...all.map((p) => p.ts))
  const tMax = Math.max(...all.map((p) => p.ts))
  const vMax = Math.max(1e-9, ...all.map((p) => p.value))
  const x = (ts: number) => (tMax === tMin ? W : ((ts - tMin) / (tMax - tMin)) * W)
  const y = (v: number) => H - (v / vMax) * (H - 6) - 3
  return (
    <div className="flex h-full flex-col">
      <div className="mb-1 flex flex-wrap gap-x-3 text-xs">
        {lines.map((l) => {
          const last = l.points[l.points.length - 1]
          return (
            <span key={l.label} className="text-text-secondary">
              <span style={{ color: `var(${l.colorVar})` }}>●</span> {l.label}{' '}
              <span className="text-text-primary font-semibold">
                {last ? format(last.value) : '-'}
              </span>
            </span>
          )
        })}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="min-h-0 w-full flex-1"
        role="img"
        aria-label="추이 차트"
      >
        {lines.map((l) => (
          <polyline
            key={l.label}
            fill="none"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: `var(${l.colorVar})` }}
            points={l.points.map((p) => `${x(p.ts)},${y(p.value)}`).join(' ')}
          />
        ))}
      </svg>
      <div className="text-text-tertiary text-right text-[10px]">최대 {format(vMax)}</div>
    </div>
  )
}
