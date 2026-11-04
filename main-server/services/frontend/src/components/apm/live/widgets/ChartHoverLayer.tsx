import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useTabActive } from '@/components/layout/tabs/TabContext'
import { mergedTimestamps, nearestIndex, pointAt } from '@/lib/apm/chartHover'
import type { SeriesPoint } from '@/lib/apm/liveData'
import { formatKST } from '@/lib/utils'

interface HoverLine {
  label: string
  /** CSS 변수 이름 (예: --color-accent) */
  colorVar: string
  points: SeriesPoint[]
}

interface ChartHoverLayerProps {
  lines: HoverLine[]
  format: (v: number) => string
  tMin: number
  tMax: number
  /** 플롯 안 위치(0~1). 차트의 x/y 스케일과 같은 식을 쓴다 */
  xFrac: (ts: number) => number
  yFrac: (v: number) => number
  ariaLabel: string
}

/** 마우스는 플롯 비율 좌표(fx, fy), 키보드는 스냅된 시각을 저장한다 */
type Hover = { mode: 'ptr'; fx: number; fy: number } | { mode: 'key'; ts: number }

/** 툴팁과 커서/플롯 가장자리 사이 간격(px) */
const GAP = 12
/** 화면 가장자리 여백(px) */
const EDGE = 4

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * 라인 차트 위에 얹는 호버 레이어. 호버 상태를 이 컴포넌트 안에만 두어
 * 포인터가 움직여도 차트(MiniChart) 본체는 다시 그려지지 않는다.
 * - 포인터: 가장 가까운 시각으로 스냅 + 세로선 + 시리즈별 점 + 툴팁
 * - 키보드(플롯에 포커스): ←/→ 로 시각 이동, Esc 로 숨김 (위젯 프레임 이동 핸들과는 별개 요소)
 */
export function ChartHoverLayer({
  lines,
  format,
  tMin,
  tMax,
  xFrac,
  yFrac,
  ariaLabel,
}: ChartHoverLayerProps) {
  const tabActive = useTabActive()
  const plotRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  // 비활성 탭에서는 툴팁이 남지 않게 숨긴다(포털은 탭 컨테이너 밖에 그려진다)
  useEffect(() => {
    if (!tabActive) setHover(null)
  }, [tabActive])

  // 호버 중에만 합집합 타임스탬프를 구한다. lines 가 그대로면 포인터 이동마다 다시 만들지 않는다
  const hovering = hover !== null
  const stamps = useMemo(() => (hovering ? mergedTimestamps(lines) : []), [lines, hovering])

  let ts: number | null = null
  if (hover && stamps.length > 0) {
    const target = hover.mode === 'ptr' ? tMin + hover.fx * (tMax - tMin) : hover.ts
    ts = stamps[nearestIndex(stamps, target)]
  }

  const rows =
    ts == null
      ? []
      : lines
          .map((l) => ({ l, p: pointAt(l.points, ts) }))
          .filter((r): r is { l: HoverLine; p: SeriesPoint } => r.p != null)
          .sort((a, b) => b.p.value - a.p.value)

  // 포인터에서 y 가 가장 가까운 시리즈를 강조(키보드는 없음)
  let nearest = -1
  if (hover?.mode === 'ptr') {
    let best = Infinity
    rows.forEach((r, n) => {
      const d = Math.abs(yFrac(r.p.value) - hover.fy)
      if (d < best) {
        best = d
        nearest = n
      }
    })
  }

  // 툴팁 위치: 세로선 오른쪽, 위젯(플롯) 오른쪽 끝을 넘으면 왼쪽으로 뒤집고 화면 안으로 보정.
  // 세로는 플롯 위쪽 가장자리에 맞춰 아래로 늘어나 플롯 위의 범례 값을 가리지 않는다
  useLayoutEffect(() => {
    const tip = tipRef.current
    const plot = plotRef.current
    if (!tip || !plot || ts == null || !hover) return
    const rect = plot.getBoundingClientRect()
    const cx = rect.left + xFrac(ts) * rect.width
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    let left = cx + GAP
    if (left + w > rect.right) left = cx - GAP - w
    left = Math.min(Math.max(left, EDGE), window.innerWidth - w - EDGE)
    const top = Math.min(Math.max(rect.top, EDGE), window.innerHeight - h - EDGE)
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
  })

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const rect = e.currentTarget.getBoundingClientRect()
    const fx = rect.width > 0 ? clamp01((e.clientX - rect.left) / rect.width) : 1
    const fy = rect.height > 0 ? clamp01((e.clientY - rect.top) / rect.height) : 0.5
    setHover({ mode: 'ptr', fx, fy })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (!hover) return // 숨길 게 없으면 확대 오버레이의 Esc(닫기)에 맡긴다
      e.preventDefault()
      e.stopPropagation()
      setHover(null)
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const all = mergedTimestamps(lines)
    if (all.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    // 처음에는 가장 최근 시각에서 시작한다
    let next = all.length - 1
    if (ts != null) {
      const cur = nearestIndex(all, ts)
      next = Math.min(all.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1)))
    }
    setHover({ mode: 'key', ts: all[next] })
  }

  const open = ts != null && rows.length > 0

  return (
    <div
      ref={plotRef}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      data-testid="chart-hover"
      data-chart-hover={open ? 'open' : undefined}
      className="focus-visible:ring-accent absolute inset-0 rounded-sm focus-visible:ring-1 focus-visible:outline-none focus-visible:ring-inset"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover((h) => (h?.mode === 'key' ? null : h))}
      onKeyDown={onKeyDown}
    >
      {open && ts != null && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
          <line
            data-testid="chart-crosshair"
            x1={`${xFrac(ts) * 100}%`}
            x2={`${xFrac(ts) * 100}%`}
            y1="0"
            y2="100%"
            strokeWidth={1}
            style={{ stroke: 'var(--color-text-tertiary)', strokeOpacity: 0.5 }}
          />
          {rows.map((r) => (
            <circle
              key={r.l.label}
              data-testid="chart-hover-dot"
              cx={`${xFrac(ts) * 100}%`}
              cy={`${yFrac(r.p.value) * 100}%`}
              r={3.5}
              strokeWidth={1.5}
              style={{ fill: `var(${r.l.colorVar})`, stroke: 'var(--color-bg-base)' }}
            />
          ))}
        </svg>
      )}
      {open &&
        ts != null &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            data-testid="chart-tooltip"
            className="bg-bg-base shadow-neu-soft border-border-alt font-num pointer-events-none fixed z-[60] min-w-32 rounded-sm border px-2 py-1.5 text-xs tabular-nums"
            style={{ left: 0, top: 0 }}
          >
            <div className="text-text-secondary mb-1">{formatKST(new Date(ts), 'HH:mm:ss')}</div>
            {rows.map((r, n) => (
              <div
                key={r.l.label}
                data-testid="chart-tooltip-row"
                data-nearest={n === nearest ? 'true' : undefined}
                className={`flex items-center gap-2 rounded-sm px-1 leading-5 ${
                  n === nearest
                    ? 'bg-bg-deep text-text-primary font-semibold'
                    : 'text-text-secondary'
                }`}
              >
                <i
                  aria-hidden
                  className="block h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: `var(${r.l.colorVar})` }}
                />
                <span className="max-w-40 min-w-0 flex-1 truncate">{r.l.label}</span>
                <span className="text-text-primary font-medium">{format(r.p.value)}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
