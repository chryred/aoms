import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ChartScaleContext, chartFonts } from '@/components/apm/live/chartScale'
import { useNavigate } from 'react-router-dom'
import { useTabActive } from '@/components/layout/tabs/TabContext'
import { useApmScatter } from '@/hooks/queries/useApmScatter'
import {
  canvasNumFont,
  cssVar,
  niceMax,
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
import { WidgetRuntimeContext, useWidgetState } from '@/components/apm/live/widgetState'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'

interface Pt {
  ts: number
  elapsed_ms: number
  error: boolean
  trace_id: string
  span_id: string
  system_id: number
}

const DOT_R = 1.75
const DOT_R_LARGE = 2.25
const LARGE_H = 360
const LIVE_WINDOW_MS = 5 * 60_000
const PAST_WINDOW_MS = 10 * 60_000
const PAD = { l: 44, r: 8, t: 8, b: 18 }
const PAD_ZOOM = { l: 52, r: 10, t: 10, b: 22 }
const OFFSETS: { label: string; min: number }[] = [
  { label: '실시간(최근 5분)', min: 0 },
  { label: '30분 전', min: 30 },
  { label: '1시간 전', min: 60 },
  { label: '3시간 전', min: 180 },
  { label: '6시간 전', min: 360 },
  { label: '24시간 전', min: 1440 },
]
const LEVEL_VAR = {
  normal: '--color-apm-normal',
  warning: '--color-apm-warning',
  critical: '--color-apm-critical',
} as const

/** 트랜잭션 모니터링(산점도. 위젯 type 키는 저장 레이아웃 호환을 위해 'scatter' 유지). 실시간 점은 SSE, 시간축을 과거로 옮기면 getScatter. 드래그로 영역을 드래그하면 트랜잭션 분석 새 탭으로 연다. */
export function ScatterWidget({ events, target, slowMs }: WidgetProps) {
  const navigate = useNavigate()
  const tabActive = useTabActive()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(wrapRef)
  // 카드와 확대 오버레이가 같은 시간 범위를 공유한다
  const [offsetMin, setOffsetMin] = useWidgetState('offsetMin', 0)
  const { closeZoom } = useContext(WidgetRuntimeContext)
  const [tick, setTick] = useState(0)
  const [drag, setDrag] = useState<Rect | null>(null)
  const live = offsetMin === 0
  const chartScale = useContext(ChartScaleContext)
  const fonts = chartFonts(chartScale)
  const pad = chartScale > 1 ? PAD_ZOOM : PAD
  // target 객체는 매 렌더 새로 만들어지므로 값(systemIds join + role)에만 의존한다
  const idsKey = target.systemIds.join(',')
  const role = target.instanceRole
  const keysKey = target.instanceKeys?.join('\n')
  const systemIds = useMemo(() => (idsKey ? idsKey.split(',').map(Number) : []), [idsKey])

  // 실시간 모드에서는 1초마다 시간축을 밀어준다
  useEffect(() => {
    if (!live || !tabActive) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live, tabActive])

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
        .filter((p) =>
          matchesTarget(p, {
            systemIds,
            instanceRole: role,
            instanceKeys: keysKey === undefined ? undefined : keysKey.split('\n').filter(Boolean),
          }),
        )
        .flatMap((p) =>
          p.points.map((pt) => ({ ...pt, error: !!pt.error, system_id: p.system_id })),
        )
        .filter((p) => p.ts >= tMin)
    }
    return (past.data?.points ?? []).map((p) => ({ ...p, ts: toMs(p.ts), error: !!p.error }))
  }, [live, events.points, systemIds, role, keysKey, past.data, tMin])

  const yMax = useMemo(
    () => niceMax(Math.max(slowMs * 3, ...points.map((p) => p.elapsed_ms))),
    [slowMs, points],
  )
  const scale = useMemo(
    () => scatterScale(tMin, tMax, yMax, width, height, pad),
    [tMin, tMax, yMax, width, height, pad],
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
    ctx.font = canvasNumFont(fonts.axis)
    ctx.fillStyle = colors.text
    ctx.strokeStyle = colors.border
    ctx.textAlign = 'right'
    for (const f of [0, 0.5, 1]) {
      const y = scale.y(yMax * f)
      ctx.beginPath()
      ctx.moveTo(pad.l, y)
      ctx.lineTo(width - pad.r, y)
      ctx.stroke()
      ctx.fillText(`${Math.round(yMax * f)}`, pad.l - 4, y + fonts.axis * 0.3)
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
    // 에러(적색)를 마지막에 그려 정상 점 위에 보이게 한다
    const r = height >= LARGE_H ? DOT_R_LARGE : DOT_R
    const ordered = [...points.filter((p) => !p.error), ...points.filter((p) => p.error)]
    ctx.lineWidth = 0.75
    for (const p of ordered) {
      const c = p.error ? colors.critical : colors[queueColor(p.elapsed_ms, slowMs)]
      ctx.beginPath()
      ctx.arc(scale.x(p.ts), scale.y(p.elapsed_ms), r, 0, Math.PI * 2)
      ctx.globalAlpha = 0.7
      ctx.fillStyle = c
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = c
      ctx.stroke()
    }
    if (drag) {
      ctx.lineWidth = 1
      ctx.fillStyle = colors.accent
      ctx.globalAlpha = 0.12
      ctx.fillRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0)
      ctx.globalAlpha = 1
      ctx.strokeStyle = colors.accent
      ctx.strokeRect(drag.x0, drag.y0, drag.x1 - drag.x0, drag.y1 - drag.y0)
    }
  }, [points, scale, width, height, tMin, tMax, yMax, slowMs, drag, pad, fonts.axis])

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
  // 드래그 영역(시간 × 응답시간) → 트랜잭션 분석 새 탭. 클릭만 한 경우는 아무것도 하지 않는다.
  const onUp = () => {
    if (!drag) return
    const r = drag
    setDrag(null)
    if (Math.abs(r.x1 - r.x0) <= 3 || Math.abs(r.y1 - r.y0) <= 3) return
    const t0 = Math.min(scale.invX(r.x0), scale.invX(r.x1))
    const t1 = Math.max(scale.invX(r.x0), scale.invX(r.x1))
    const m0 = Math.min(scale.invY(r.y0), scale.invY(r.y1))
    const m1 = Math.max(scale.invY(r.y0), scale.invY(r.y1))
    const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const qs = new URLSearchParams({
      from: iso(Math.floor(t0 / 1000) * 1000),
      to: iso(Math.ceil(t1 / 1000) * 1000),
      min_ms: String(Math.max(0, Math.floor(m0))),
      max_ms: String(Math.ceil(m1)),
    })
    for (const id of systemIds) qs.append('system', String(id))
    if (role) qs.set('instance', role)
    // 확대 오버레이가 열려 있으면 먼저 닫아 새 탭이 가려지지 않게 한다
    closeZoom()
    navigate(`${ROUTES.APM_TRANSACTIONS}?${qs}`)
  }

  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center gap-2" style={{ fontSize: fonts.legend }}>
        <select
          aria-label="산점도 시간 범위"
          value={offsetMin}
          onChange={(e) => setOffsetMin(Number(e.target.value))}
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
          aria-label="트랜잭션 모니터링"
          style={{ width, height }}
          className="cursor-crosshair"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        />
      </div>
    </div>
  )
}
