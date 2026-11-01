import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApmScatter } from '@/hooks/queries/useApmScatter'
import {
  canvasFont,
  cssVar,
  niceMax,
  pointsInRect,
  prepareCanvas,
  scatterScale,
  toMs,
  useElementSize,
  type Rect,
} from '@/lib/apm/canvas'
import { matchesTarget } from '@/lib/apm/liveData'
import { queueColor } from '@/lib/apm/queueBuckets'
import { ROUTES } from '@/constants/routes'
import { formatKST } from '@/lib/utils'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'

interface Pt {
  ts: number
  elapsed_ms: number
  error: boolean
  trace_id: string
  span_id: string
  system_id: number
}

const LIVE_WINDOW_MS = 5 * 60_000
const PAST_WINDOW_MS = 10 * 60_000
const PAD = { l: 44, r: 8, t: 8, b: 18 }
const OFFSETS: { label: string; min: number }[] = [
  { label: '실시간(최근 5분)', min: 0 },
  { label: '30분 전', min: 30 },
  { label: '1시간 전', min: 60 },
  { label: '3시간 전', min: 180 },
  { label: '6시간 전', min: 360 },
  { label: '24시간 전', min: 1440 },
]
const LEVEL_VAR = {
  normal: '--color-normal',
  warning: '--color-warning',
  critical: '--color-critical',
} as const

/** 응답시간 산점도. 실시간 점은 SSE, 시간축을 과거로 옮기면 getScatter. 드래그로 영역 선택. */
export function ScatterWidget({ events, target, slowMs }: WidgetProps) {
  const navigate = useNavigate()
  const { systemName } = useContext(LiveContext)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(wrapRef)
  const [offsetMin, setOffsetMin] = useState(0)
  const [tick, setTick] = useState(0)
  const [drag, setDrag] = useState<Rect | null>(null)
  const [selected, setSelected] = useState<Pt[]>([])
  const live = offsetMin === 0
  // target 객체는 매 렌더 새로 만들어지므로 값(systemIds join + role)에만 의존한다
  const idsKey = target.systemIds.join(',')
  const role = target.instanceRole
  const systemIds = useMemo(() => (idsKey ? idsKey.split(',').map(Number) : []), [idsKey])

  // 실시간 모드에서는 1초마다 시간축을 밀어준다
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [tick, offsetMin])
  const tMax = live ? now : now - offsetMin * 60_000
  const tMin = tMax - (live ? LIVE_WINDOW_MS : PAST_WINDOW_MS)

  const past = useApmScatter(
    {
      system_ids: systemIds,
      start: new Date(tMin).toISOString(),
      end: new Date(tMax).toISOString(),
    },
    !live,
  )

  const points: Pt[] = useMemo(() => {
    if (live) {
      return events.points
        .filter((p) => matchesTarget(p, { systemIds, instanceRole: role }))
        .flatMap((p) =>
          p.points.map((pt) => ({ ...pt, error: !!pt.error, system_id: p.system_id })),
        )
        .filter((p) => p.ts >= tMin)
    }
    return (past.data?.points ?? []).map((p) => ({ ...p, ts: toMs(p.ts), error: !!p.error }))
  }, [live, events.points, systemIds, role, past.data, tMin])

  const yMax = useMemo(
    () => niceMax(Math.max(slowMs * 3, ...points.map((p) => p.elapsed_ms))),
    [slowMs, points],
  )
  const scale = useMemo(
    () => scatterScale(tMin, tMax, yMax, width, height, PAD),
    [tMin, tMax, yMax, width, height],
  )

  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, width, height)
    if (!ctx) return
    // 색은 그리기 1회당 한 번만 해석한다 (점마다 getComputedStyle 호출 금지)
    const colors = {
      text: cssVar('--color-text-secondary'),
      border: cssVar('--color-border'),
      accent: cssVar('--color-accent'),
      critical: cssVar('--color-critical'),
      normal: cssVar(LEVEL_VAR.normal),
      warning: cssVar(LEVEL_VAR.warning),
    }
    ctx.font = canvasFont(10)
    ctx.fillStyle = colors.text
    ctx.strokeStyle = colors.border
    ctx.textAlign = 'right'
    for (const f of [0, 0.5, 1]) {
      const y = scale.y(yMax * f)
      ctx.beginPath()
      ctx.moveTo(PAD.l, y)
      ctx.lineTo(width - PAD.r, y)
      ctx.stroke()
      ctx.fillText(`${Math.round(yMax * f)}`, PAD.l - 4, y + 3)
    }
    for (const f of [0, 0.5, 1]) {
      // 양 끝 라벨은 캔버스 밖으로 잘리지 않도록 정렬 기준을 바꾼다
      ctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center'
      ctx.fillText(
        formatKST(new Date(tMin + (tMax - tMin) * f), 'HH:mm:ss'),
        scale.x(tMin + (tMax - tMin) * f),
        height - 4,
      )
    }
    for (const p of points) {
      ctx.fillStyle = p.error ? colors.critical : colors[queueColor(p.elapsed_ms, slowMs)]
      ctx.fillRect(scale.x(p.ts) - 1.5, scale.y(p.elapsed_ms) - 1.5, 3, 3)
    }
    if (drag) {
      ctx.strokeStyle = colors.accent
      ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0)
    }
  }, [points, scale, width, height, tMin, tMax, yMax, slowMs, drag])

  const local = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = local(e)
    setDrag({ x0: x, y0: y, x1: x, y1: y })
  }
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag) return
    const { x, y } = local(e)
    setDrag({ ...drag, x1: x, y1: y })
  }
  const onUp = () => {
    if (!drag) return
    const picked =
      Math.abs(drag.x1 - drag.x0) > 3 || Math.abs(drag.y1 - drag.y0) > 3
        ? pointsInRect(points, scale, drag)
        : []
    setSelected(picked.sort((a, b) => b.elapsed_ms - a.elapsed_ms).slice(0, 100))
    setDrag(null)
  }

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <select
          aria-label="산점도 시간 범위"
          value={offsetMin}
          onChange={(e) => {
            setOffsetMin(Number(e.target.value))
            setSelected([])
          }}
          className="bg-bg-base border-border text-text-primary rounded-sm border px-1 py-0.5"
        >
          {OFFSETS.map((o) => (
            <option key={o.min} value={o.min}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-text-secondary">{points.length.toLocaleString()}건</span>
        {!live && role && (
          <span className="text-text-tertiary">과거 구간은 WAS 구분 없이 표시</span>
        )}
        {past.data?.truncated && <span className="text-warning-text">일부만 표시</span>}
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="응답시간 산점도"
          style={{ width, height }}
          className="cursor-crosshair"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        />
      </div>
      {selected.length > 0 && (
        <div
          className="border-border max-h-28 overflow-auto border-t text-xs"
          aria-label="선택 영역 트랜잭션"
        >
          {selected.map((p) => (
            <button
              key={`${p.trace_id}:${p.span_id}`}
              type="button"
              onClick={() => navigate(ROUTES.apmTx(p.trace_id, p.span_id))}
              className="hover:bg-hover-subtle flex w-full gap-3 px-1 py-0.5 text-left"
            >
              <span className="text-text-secondary">{formatKST(new Date(p.ts), 'HH:mm:ss')}</span>
              <span className="text-text-secondary">{systemName(p.system_id)}</span>
              <span className={p.error ? 'text-critical-text' : 'text-text-primary'}>
                {p.elapsed_ms}ms
              </span>
              <span className="text-text-tertiary truncate">{p.trace_id.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
