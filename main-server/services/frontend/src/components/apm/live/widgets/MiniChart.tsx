import { useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChartScaleContext, chartFonts } from '@/components/apm/live/chartScale'
import type { SeriesPoint } from '@/lib/apm/liveData'
import { formatKST } from '@/lib/utils'
import { abbreviateLabel, visibleYLabels } from '@/lib/apm/chartLabels'
import { ChartHoverLayer } from './ChartHoverLayer'

interface Line {
  label: string
  /** CSS 변수 이름 (예: --color-accent) */
  colorVar: string
  points: SeriesPoint[]
  /** true 면 선을 점선으로 (예: 상한/최대 기준선) */
  dashed?: boolean
}

interface MiniChartProps {
  lines: Line[]
  format?: (v: number) => string
  emptyText?: string
  /** 범례 행 오른쪽에 붙는 보조 값 (예: 동시 사용자). 별도 행을 만들지 않아 카드끼리 차트 영역이 어긋나지 않는다 */
  extra?: ReactNode
  /** 범례 바로 뒤에 붙는 도움말 아이콘 (오른쪽 끝 extra 와 달리 제목·범례 옆에 머문다) */
  hint?: ReactNode
  /** 글자 배율. 생략하면 확대 오버레이가 내려주는 값(기본 1)을 따른다 */
  scale?: number
}

const W = 300
const H = 100
/** 위·아래 여백(viewBox 단위 = %) */
const PAD_Y = 3

/** y축 라벨 사이 최소 세로 간격(px) */
const MIN_LABEL_GAP = 12

/** 범례 행: 모든 차트 위젯에서 같은 최소 높이를 가져 차트 영역 시작선을 맞춘다. */
function LegendRow({
  children,
  extra,
  hint,
  fontSize,
}: {
  children?: ReactNode
  extra?: ReactNode
  hint?: ReactNode
  fontSize: number
}) {
  return (
    <div
      data-testid="chart-legend"
      style={{ fontSize }}
      className="mb-1 flex min-h-5 flex-wrap items-center gap-x-3 leading-5"
    >
      {children}
      {hint}
      {extra != null && <span className="text-text-secondary ml-auto">{extra}</span>}
    </div>
  )
}

/** 의존성 없는 반응형 SVG 라인 차트. 색은 CSS 변수만 사용. */
export function MiniChart({
  lines,
  format = (v) => v.toFixed(1),
  emptyText = '수신 대기',
  extra,
  hint,
  scale: scaleProp,
}: MiniChartProps) {
  const ctxScale = useContext(ChartScaleContext)
  const scale = scaleProp ?? ctxScale
  const fonts = chartFonts(scale)
  const uid = useId().replace(/:/g, '')
  const all = lines.flatMap((l) => l.points)
  const empty = all.length === 0
  const axisRef = useRef<HTMLDivElement>(null)
  const [axisH, setAxisH] = useState(0)
  useEffect(() => {
    const el = axisRef.current
    if (!el) return
    const measure = () => setAxisH(el.clientHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [empty])
  if (empty) {
    return (
      <div className="flex h-full flex-col">
        <LegendRow extra={extra} hint={hint} fontSize={fonts.legend} />
        <div className="text-text-tertiary flex min-h-0 flex-1 items-center justify-center text-xs">
          {emptyText}
        </div>
      </div>
    )
  }
  const tMin = Math.min(...all.map((p) => p.ts))
  const tMax = Math.max(...all.map((p) => p.ts))
  const vMax = Math.max(1e-9, ...all.map((p) => p.value))
  const x = (ts: number) => (tMax === tMin ? W : ((ts - tMin) / (tMax - tMin)) * W)
  const y = (v: number) => H - (v / vMax) * (H - 2 * PAD_Y) - PAD_Y
  // 면적 채움: 위(선)에서 아래(기준선)로 사라지는 세로 그라디언트. 시리즈가 여럿이면 겹침을 고려해 옅게
  const topOpacity = lines.length > 1 ? 0.12 : 0.28
  // 아래쪽도 0 이 아니라 옅게 남겨, 거의 0 에 붙은 스파이크 차트에서도 면적이 보이게 한다
  const bottomOpacity = lines.length > 1 ? 0.03 : 0.04
  const gridYs = [PAD_Y, H / 2, H - PAD_Y]
  const labels = [format(vMax), format(vMax / 2), format(0)].map(abbreviateLabel)
  const shown = visibleYLabels(axisH, H, PAD_Y, Math.max(MIN_LABEL_GAP, fonts.axis + 2))
  return (
    <div className="flex h-full flex-col">
      <LegendRow extra={extra} hint={hint} fontSize={fonts.legend}>
        {lines.map((l) => {
          const last = l.points[l.points.length - 1]
          return (
            <span key={l.label} className="text-text-secondary flex items-center gap-1">
              <i
                aria-hidden
                className="block h-2 w-2 shrink-0 rounded-xs"
                style={{ background: `var(${l.colorVar})` }}
              />
              {l.label}{' '}
              <span className="text-text-primary font-num font-medium tabular-nums">
                {last ? format(last.value) : '-'}
              </span>
            </span>
          )
        })}
      </LegendRow>
      <div className="flex min-h-0 flex-1 gap-1">
        <div
          ref={axisRef}
          aria-hidden="true"
          data-testid="chart-yaxis"
          style={{ width: fonts.yAxisW, fontSize: fonts.axis }}
          className="text-text-secondary font-num relative shrink-0 text-right leading-none tabular-nums"
        >
          {labels.map((t, n) =>
            !shown[n] ? null : (
              <span
                key={n}
                data-testid={n === 0 ? 'chart-ymax' : n === 1 ? 'chart-ymid' : 'chart-ymin'}
                className="absolute right-0 -translate-y-1/2"
                style={{ top: `${gridYs[n]}%` }}
              >
                {t}
              </span>
            ),
          )}
        </div>
        <div className="relative min-h-0 min-w-0 flex-1">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label="추이 차트"
          >
            <defs>
              {lines.map((l, n) => (
                <linearGradient
                  key={l.label}
                  id={`${uid}-${n}`}
                  gradientUnits="userSpaceOnUse"
                  x1={0}
                  x2={0}
                  y1={PAD_Y}
                  y2={H - PAD_Y}
                >
                  <stop
                    offset="0"
                    style={{ stopColor: `var(${l.colorVar})` }}
                    stopOpacity={topOpacity}
                  />
                  <stop
                    offset="1"
                    style={{ stopColor: `var(${l.colorVar})` }}
                    stopOpacity={bottomOpacity}
                  />
                </linearGradient>
              ))}
            </defs>
            {gridYs.map((gy) => (
              <line
                key={gy}
                data-testid="chart-grid"
                x1={0}
                x2={W}
                y1={gy}
                y2={gy}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="3 3"
                style={{ stroke: 'var(--color-border)' }}
              />
            ))}
            {lines.map((l, n) => {
              if (l.points.length === 0) return null
              const pts = l.points.map((p) => `${x(p.ts)},${y(p.value)}`)
              return (
                <g key={l.label}>
                  <polygon
                    data-testid="chart-area"
                    points={`${pts.join(' ')} ${x(l.points[l.points.length - 1].ts)},${H - PAD_Y} ${x(l.points[0].ts)},${H - PAD_Y}`}
                    fill={`url(#${uid}-${n})`}
                  />
                  <polyline
                    fill="none"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={l.dashed ? '4 3' : undefined}
                    style={{ stroke: `var(${l.colorVar})` }}
                    points={pts.join(' ')}
                  />
                </g>
              )
            })}
          </svg>
          {/* 끝점: 늘어나는 viewBox 와 분리해 퍼센트 좌표로 찍어야 원이 찌그러지지 않는다 */}
          <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
            {lines.map((l) => {
              const last = l.points[l.points.length - 1]
              if (!last) return null
              return (
                <circle
                  key={l.label}
                  data-testid="chart-endpoint"
                  cx={`${(x(last.ts) / W) * 100}%`}
                  cy={`${(y(last.value) / H) * 100}%`}
                  r={3}
                  style={{ fill: `var(${l.colorVar})` }}
                />
              )
            })}
          </svg>
          {/* 호버 레이어: 툴팁·세로선·점. 호버 상태는 이 레이어 안에만 있어 차트 본체가 다시 그려지지 않는다 */}
          <ChartHoverLayer
            lines={lines}
            format={format}
            tMin={tMin}
            tMax={tMax}
            xFrac={(ts) => x(ts) / W}
            yFrac={(v) => y(v) / H}
            ariaLabel="추이 차트 값 보기 (좌우 방향키로 시점 이동, Esc로 닫기)"
          />
        </div>
      </div>
      <div
        data-testid="chart-time-axis"
        style={{ paddingLeft: fonts.timePad, fontSize: fonts.axis }}
        className="text-text-secondary font-num mt-0.5 flex justify-between gap-1 leading-none whitespace-nowrap tabular-nums"
      >
        <span>{formatKST(new Date(tMin), 'HH:mm:ss')}</span>
        <span>{formatKST(new Date(tMax), 'HH:mm:ss')}</span>
      </div>
    </div>
  )
}
