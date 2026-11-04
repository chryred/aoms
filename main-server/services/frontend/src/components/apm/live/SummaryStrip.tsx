import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { cssVar, prepareCanvas } from '@/lib/apm/canvas'
import {
  BALL_R,
  PAUSED_R,
  TAIL_LEN,
  TRAVEL_MS,
  advanceFlow,
  advancePaused,
  collectNewFlow,
  collectPaused,
  completePaused,
  easeInOut,
  enqueueFlow,
  exitPose,
  flowCount,
  mixColor,
  newFlow,
  newPaused,
  pulseFactor,
  recolorProgress,
  stepPaused,
  syncPaused,
  withPlaceholders,
  zoneBounds,
  type FlowState,
  type PausedLevel,
  type PausedState,
  type PausedTx,
} from '@/lib/apm/flowParticles'
import type { LiveSummary } from '@/lib/apm/liveScope'
import type { LiveActiveEvent, LivePointsEvent } from '@/types/apm'

interface StatProps {
  label: string
  value: string
  /** 값 색 (시맨틱 텍스트 토큰 클래스). 기본은 본문 색 */
  tone?: string
  /** 숫자 크기. 기본 큰 숫자(25px), compact 는 22px */
  compact?: boolean
}

/** 숫자 오른쪽에 라벨이 인라인으로 붙는 한 줄(기준선 정렬). dl 의미 순서(dt, dd)를 지키려고 시각 순서만 뒤집는다. */
const Stat = ({ label, value, tone = 'text-text-primary', compact = false }: StatProps) => (
  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
    <dt className="text-text-secondary order-2 text-[13px] whitespace-nowrap">{label}</dt>
    <dd
      className={cn(
        'font-num order-1 font-medium tabular-nums',
        compact ? 'text-[22px]' : 'text-[25px]',
        // tailwind-merge 는 text-[Npx] 뒤의 leading-* 만 남긴다 — 순서를 바꾸면 line-height 1 이 사라진다
        'leading-none',
        tone,
      )}
    >
      {value}
    </dd>
  </div>
)

/** 트랙(공이 흐르는 영역)이 차지하는 띠 하단 높이(px) */
const TRACK_H = 64

/** 트랙(기준선·공·꼬리·정지 공)이 띠 좌우 가장자리에서 안쪽으로 들어오는 거리(px) */
const TRACK_INSET = 36
/** 공이 트랙 끝에 닿기 전에 투명해지기 시작하는 거리(px) / 시작점에서 나타나는 거리(px) */
const FADE_OUT = 40
const FADE_IN = 24

/** 트랙을 가로지르는 짧은 세로 구분선: 양 끝이 옅어진다 */
const DIVIDER_STYLE = {
  background:
    'linear-gradient(to bottom, transparent, var(--color-border-alt) 25%, var(--color-border-alt) 75%, transparent)',
} as const

interface SummaryStripProps {
  summary: LiveSummary
  /** 실시간 스트림의 완료 트랜잭션 점 이벤트 */
  points?: LivePointsEvent[]
  /** 흘려보낼 인스턴스 키 (체크된 범위 안) */
  keys?: string[]
  /** 인스턴스 키 -> 시리즈 색 CSS 변수 이름. 공은 트랜잭션을 만든 인스턴스의 색으로 흐른다 */
  colorVars?: ReadonlyMap<string, string>
  /** 실시간 스트림의 진행 중 트랜잭션. 경고·심각 건은 가운데 구역에 멈춘 공으로 보인다 */
  active?: ReadonlyMap<string, LiveActiveEvent>
  /** true 면 공 애니메이션(rAF)을 멈춘다 (숨겨진 탭) */
  paused?: boolean
}

/** CSS 색(hex/rgb)에 알파를 입힌다. 파싱 못 하면 원색 그대로(투명 정지점은 transparent) */
const withAlpha = (color: string, alpha: number) => {
  const c = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (d) => d + d) : hex[1]
    const n = parseInt(h, 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(c)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  return alpha === 0 ? 'transparent' : c
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Intermax 상단 패널 식 요약 띠(약 132px): 왼쪽 진행 건수, 가운데 상태별 건수, 오른쪽 응답(TPS·평균·에러율).
 * 아래 트랙에는 완료된 트랜잭션마다 빛나는 큰 공(긴 꼬리 포함)이 왼쪽에서 오른쪽으로 흐른다.
 * 화면에는 항상 공 하나만 보이고(나머지는 대기열), 색은 트랜잭션을 만든 인스턴스의 시리즈 색이다.
 * 모션 줄이기 설정이면 애니메이션 없이 숫자만 보인다.
 */
export function SummaryStrip({
  summary,
  points = [],
  keys = [],
  colorVars,
  active,
  paused = false,
}: SummaryStripProps) {
  const [reduced] = useState(prefersReducedMotion)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const flow = useRef<FlowState>(newFlow())
  const colorOf = useRef<(key: string) => string | undefined>(() => undefined)
  colorOf.current = (key) => colorVars?.get(key)
  const seen = useRef<Set<string> | null>(null)
  const pausedBalls = useRef<PausedState>(newPaused())
  const completed = useRef<Set<string>>(new Set())
  const lastPaused = useRef<PausedTx[]>([])
  const wasPaused = useRef(false)
  // 가운데 구역 공 중심 범위(draw 가 측정해 갱신, 측정 전에는 null)와 마지막 active snapshot 수신 시각
  const bounds = useRef<readonly [number, number] | null>(null)
  const lastActive = useRef<ReadonlyMap<string, LiveActiveEvent> | undefined>(undefined)
  const snapAt = useRef(0)
  const divA = useRef<HTMLSpanElement>(null)
  const divB = useRef<HTMLSpanElement>(null)
  const kick = useRef<() => void>(() => {})

  // 새 점 -> 대기열. 첫 렌더에 이미 있던 점은 흘려보내지 않고 기록만 한다.
  useEffect(() => {
    if (reduced) return
    const of = (k: string) => colorOf.current(k)
    if (seen.current === null) {
      seen.current = new Set()
      collectNewFlow(points, seen.current, new Set(), of, Date.now())
      return
    }
    const added = collectNewFlow(points, seen.current, new Set(keys), of, Date.now())
    if (seen.current.size > 5000) {
      seen.current = new Set(
        points.flatMap((e) => e.points.map((p) => `${p.trace_id}:${p.span_id}`)),
      )
    }
    if (added.length === 0) return
    if (paused) return // 숨겨진 동안 쌓인 점은 흘려보내지 않는다
    flow.current = enqueueFlow(flow.current, added)
    if (canvasRef.current) canvasRef.current.dataset.particles = String(flowCount(flow.current))
    kick.current()
  }, [points, keys, reduced, paused])

  // 진행 중인 느린 건 -> 가운데 구역의 정지 공. 완료 점이 먼저 오면 즉시 빠져나가게 한다.
  // 숨겨진 탭에서는 갱신하지 않고, 다시 보일 때 현재 snapshot 으로 처음부터 다시 만든다.
  useEffect(() => {
    if (reduced) return
    if (paused) {
      wasPaused.current = true
      return
    }
    const now = performance.now()
    if (wasPaused.current) {
      wasPaused.current = false
      pausedBalls.current = newPaused()
      snapAt.current = now
    }
    // snapshot 이 새로 왔을 때만 경과 기준 시각을 갱신한다(점만 바뀐 재실행에서 외삽이 되감기지 않게)
    if (lastActive.current !== active) {
      lastActive.current = active
      snapAt.current = now
    }
    const done = completed.current
    for (const ev of points) for (const p of ev.points) done.add(`${p.trace_id}:${p.span_id}`)
    if (done.size > 5000) done.clear()
    const keySet = new Set(keys)
    const cur = withPlaceholders(
      collectPaused(active ?? new Map(), keySet, done),
      active ?? new Map(),
      keySet,
    )
    lastPaused.current = cur
    pausedBalls.current = completePaused(pausedBalls.current, done, now)
    // 구역을 아직 측정하지 못했으면 폭 기준 임시 범위로 배치하고, 첫 draw 가 측정값으로 다시 모은다
    const w = wrapRef.current?.clientWidth || 600
    const [lo, hi] =
      bounds.current ??
      zoneBounds(Math.max(TRACK_INSET, w / 3), Math.min(w - TRACK_INSET, (w * 2) / 3))
    pausedBalls.current = syncPaused(
      pausedBalls.current,
      cur,
      lo,
      hi,
      now,
      snapAt.current,
      TRACK_INSET,
    )
    if (canvasRef.current) {
      const shown = pausedBalls.current.balls.filter((b) => b.exitT0 == null).length
      canvasRef.current.dataset.paused = String(shown)
      canvasRef.current.dataset.pausedOverflow = String(pausedBalls.current.overflow)
    }
    kick.current()
  }, [active, points, keys, reduced, paused])

  // 렌더 루프: 보일 때만, 입자가 있을 때만 돈다.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (reduced || !wrap || !canvas) return
    let size = { w: wrap.clientWidth || 600, h: wrap.clientHeight || 132 }
    let colors: Record<string, string> = {}
    const readColors = () => {
      colors = {
        track: cssVar('--color-border'),
        normal: cssVar('--color-apm-normal'),
        warning: cssVar('--color-apm-warning'),
        critical: cssVar('--color-apm-critical'),
        normalRing: cssVar('--color-apm-normal-text'),
        warningRing: cssVar('--color-apm-warning-text'),
        criticalRing: cssVar('--color-apm-critical-text'),
        light: document.documentElement.classList.contains('light') ? '1' : '',
        label: cssVar('--color-text-secondary'),
      }
    }
    readColors()
    let visible = !paused
    let raf = 0
    // 공이 없어도 첫 렌더·크기·테마 변경 때는 기준선을 다시 그려야 한다
    let dirty = true

    // 가운데 구역(두 구분선 사이). 측정 못 하면(레이아웃 전·좁은 화면) 폭의 1/3~2/3
    const zone = () => {
      const w = wrap.getBoundingClientRect()
      const a = divA.current?.getBoundingClientRect()
      const b = divB.current?.getBoundingClientRect()
      const lo = TRACK_INSET
      const hi = size.w - TRACK_INSET
      if (a && b && b.left - a.right > 8)
        return [Math.max(lo, a.right - w.left), Math.min(hi, b.left - w.left)] as const
      return [Math.max(lo, size.w / 3), Math.min(hi, (size.w * 2) / 3)] as const
    }
    const levelColor = (l: PausedLevel) => colors[l] || colors.track
    const ringColor = (l: PausedLevel) => colors[`${l}Ring`] || colors.track
    const drawPaused = (ctx: CanvasRenderingContext2D, now: number, cy: number) => {
      const [x0, x1] = zone()
      const [lo, hi] = zoneBounds(x0, x1)
      const prev = bounds.current
      bounds.current = [lo, hi]
      if (!prev || prev[0] !== lo || prev[1] !== hi) {
        // 구역 범위가 바뀌면(첫 측정 포함) 현재 범위로 다시 모으고 배치한다
        pausedBalls.current = syncPaused(
          pausedBalls.current,
          lastPaused.current,
          lo,
          hi,
          now,
          snapAt.current,
          TRACK_INSET,
        )
      }
      pausedBalls.current = advancePaused(stepPaused(pausedBalls.current, now, lo, hi), now)
      const { balls, overflow } = pausedBalls.current
      canvas.dataset.paused = String(balls.filter((b) => b.exitT0 == null).length)
      canvas.dataset.pausedOverflow = String(overflow)
      const pulse = pulseFactor(now, false)
      // 빠져나가는 공을 먼저 그려 멈춰 있는 공 아래에 깔리게 한다
      const drawOrder = [
        ...balls.filter((b) => b.exitT0 != null),
        ...balls.filter((b) => b.exitT0 == null),
      ]
      for (const b of drawOrder) {
        const exiting = b.exitT0 != null
        // 트랙 왼쪽 끝에서 들어오는 공은 시작점에서 서서히 나타난다
        const pose = exiting
          ? exitPose(b, now)
          : {
              x: b.x,
              dy: 0,
              scale: 1,
              alpha: Math.max(0, Math.min(1, (b.x - TRACK_INSET) / FADE_IN + 0.5)),
            }
        const color = mixColor(
          levelColor(b.prevLevel),
          levelColor(b.level),
          recolorProgress(b, now),
        )
        // 빠져나가는 공도 트랙 끝(안쪽 여백)에 닿기 전에 투명해진다
        const edgeFade = Math.max(0, Math.min(1, (size.w - TRACK_INSET - pose.x) / FADE_OUT))
        ctx.globalAlpha = exiting ? pose.alpha * edgeFade : pose.alpha
        // 라이트 테마는 글로우 대신 또렷한 테두리(번진 노랑이 갈색 덩어리로 보이지 않게)
        const light = !!colors.light
        ctx.shadowColor = color
        ctx.shadowBlur = light ? 0 : PAUSED_R * (exiting ? 0.6 : 0.6 + 0.5 * pulse)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(pose.x, cy + pose.dy, PAUSED_R * pose.scale, 0, Math.PI * 2)
        if (light) {
          ctx.fill()
          ctx.lineWidth = 1.5
          ctx.strokeStyle = mixColor(
            ringColor(b.prevLevel),
            ringColor(b.level),
            recolorProgress(b, now),
          )
          ctx.stroke()
          continue
        }
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      if (overflow > 0) {
        ctx.fillStyle = colors.label
        ctx.font = '11px sans-serif'
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(`+${overflow}`, x1 - 8, cy - PAUSED_R - 6)
      }
    }

    const draw = (now: number) => {
      raf = 0
      dirty = false
      const ctx = prepareCanvas(canvas, size.w, size.h)
      if (!ctx) return
      const cy = size.h - TRACK_H / 2
      // 트랙 기준선은 공이 없어도 항상 전체 폭으로 그린다
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = colors.track
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(TRACK_INSET, cy)
      ctx.lineTo(size.w - TRACK_INSET, cy)
      ctx.stroke()
      flow.current = advanceFlow(flow.current, now)
      drawPaused(ctx, now, cy)
      const ball = flow.current.ball
      if (ball) {
        // 흐르는 공은 항상 옅은 파랑(정상). 지연된 건만 구역에서 노랑·빨강으로 바뀐다
        const color = colors.normal || cssVar('--color-accent')
        const prog = easeInOut((now - ball.t0) / TRAVEL_MS)
        // 공은 트랙 시작점(안쪽 여백)에서 나타나 끝점까지 가며 마지막 구간에서 투명해진다.
        // 꼬리는 시작점(안쪽 여백)보다 왼쪽으로 나가지 않아 시작점에서 자라나듯 보인다
        const trackW = size.w - 2 * TRACK_INSET
        const x = TRACK_INSET + prog * trackW
        const edge = Math.min((x - TRACK_INSET) / FADE_IN, (size.w - TRACK_INSET - x) / FADE_OUT, 1)
        const fade = Math.max(0, edge)
        // 꼬리: 하나의 모양(끝이 가늘어지는 캡슐)을 투명 -> 색 선형 그라디언트로 채운다
        const tailH = BALL_R * 1.2
        const tx = Math.max(x - TAIL_LEN, TRACK_INSET)
        const grad = ctx.createLinearGradient(tx, 0, x, 0)
        grad.addColorStop(0, withAlpha(color, 0))
        grad.addColorStop(1, withAlpha(color, 0.6))
        ctx.globalAlpha = fade
        ctx.fillStyle = grad
        // 라이트 테마는 글로우 없이 링으로 윤곽을 잡는다(멈춘 공과 같은 규칙)
        const lightTheme = !!colors.light
        ctx.shadowColor = color
        ctx.shadowBlur = lightTheme ? 0 : BALL_R * 0.6
        ctx.beginPath()
        ctx.moveTo(tx, cy)
        ctx.quadraticCurveTo(tx + (x - tx) * 0.55, cy - tailH * 0.12, x, cy - tailH / 2)
        ctx.bezierCurveTo(
          x + tailH * 0.4,
          cy - tailH / 2,
          x + tailH * 0.4,
          cy + tailH / 2,
          x,
          cy + tailH / 2,
        )
        ctx.quadraticCurveTo(tx + (x - tx) * 0.55, cy + tailH * 0.12, tx, cy)
        ctx.closePath()
        ctx.fill()
        // 공: 시리즈 색 본체 + 글로우, 같은 색으로 아주 옅은 가산 오버레이만 얹는다
        ctx.shadowBlur = lightTheme ? 0 : BALL_R * 1.1
        ctx.globalAlpha = fade
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, cy, BALL_R, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        if (lightTheme) {
          ctx.lineWidth = 1.5
          ctx.strokeStyle = colors.normalRing
          ctx.stroke()
        }
        ctx.globalCompositeOperation = lightTheme ? 'source-over' : 'lighter'
        const core = ctx.createRadialGradient(x, cy, 0, x, cy, BALL_R)
        core.addColorStop(0, withAlpha(color, 1))
        core.addColorStop(1, withAlpha(color, 0))
        ctx.globalAlpha = lightTheme ? 0 : 0.15 * fade
        ctx.fillStyle = core
        ctx.beginPath()
        ctx.arc(x, cy, BALL_R, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
        ctx.shadowColor = 'transparent'
      }
      ctx.globalAlpha = 1
      if (flowCount(flow.current) > 0 || pausedBalls.current.balls.length > 0) schedule()
    }
    const schedule = () => {
      if (raf || !visible || document.hidden) return
      if (!dirty && flowCount(flow.current) === 0 && pausedBalls.current.balls.length === 0) return
      raf = requestAnimationFrame(() => draw(performance.now()))
    }
    kick.current = schedule

    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    const onVisibility = () => (document.hidden ? stop() : schedule())
    document.addEventListener('visibilitychange', onVisibility)

    let io: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting && !paused
        if (visible) schedule()
        else stop()
      })
      io.observe(wrap)
    }
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          size = { w: Math.floor(width), h: Math.floor(height) }
          prepareCanvas(canvas, size.w, size.h)
          dirty = true
          schedule()
        }
      })
      ro.observe(wrap)
    }
    // Dark/Light 전환 시 토큰 색을 다시 읽는다
    const mo = new MutationObserver(() => {
      readColors()
      dirty = true
      schedule()
    })
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })

    prepareCanvas(canvas, size.w, size.h)
    schedule()
    return () => {
      stop()
      kick.current = () => {}
      document.removeEventListener('visibilitychange', onVisibility)
      io?.disconnect()
      ro?.disconnect()
      mo.disconnect()
    }
  }, [reduced, paused])

  return (
    <div
      ref={wrapRef}
      className="bg-bg-base shadow-neu-soft relative min-h-[132px] overflow-hidden rounded-sm sm:h-[132px] 2xl:h-[140px]"
    >
      {!reduced && (
        <canvas
          ref={canvasRef}
          aria-hidden
          data-testid="summary-flow"
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      )}
      <dl
        aria-label="요약"
        className="relative grid grid-cols-1 items-start gap-y-3 sm:h-full sm:grid-cols-[1fr_17rem_1fr] sm:grid-rows-[1fr_64px] sm:gap-y-0"
      >
        <div className="flex flex-col items-center gap-0.5 px-6 pt-[18px] sm:items-start lg:px-8">
          <Stat label="현재 진행 건수" value={String(summary.active)} />
          <Stat
            label="평균 응답"
            value={summary.avgMs == null ? '-' : `${Math.round(summary.avgMs)}ms`}
          />
        </div>
        <div className="flex items-start justify-center gap-4 px-4 pt-[20px] lg:gap-6 lg:px-8">
          <Stat compact label="정상" value={String(summary.normal)} tone="text-apm-normal-text" />
          <Stat compact label="경고" value={String(summary.warning)} tone="text-apm-warning-text" />
          <Stat
            compact
            label="심각"
            value={String(summary.critical)}
            tone="text-apm-critical-text"
          />
        </div>
        <div className="flex flex-col items-center gap-0.5 px-6 pt-[18px] sm:items-end lg:px-8">
          <Stat label="응답/초 (TPS)" value={summary.tps.toFixed(1)} />
          <Stat
            label="에러율"
            value={summary.errRate == null ? '-' : `${summary.errRate.toFixed(1)}%`}
          />
        </div>
        {/* 트랙 행: 숫자 영역 아래. 구분선은 이 행에서만, 트랙 중앙에 걸쳐 짧게 그린다 */}
        <div
          aria-hidden
          data-testid="band-track"
          className="hidden grid-cols-subgrid items-center sm:col-span-3 sm:grid"
        >
          <div className="justify-self-end">
            <span
              ref={divA}
              data-testid="band-divider"
              className="block h-16 w-px"
              style={DIVIDER_STYLE}
            />
          </div>
          <div className="justify-self-end">
            <span
              ref={divB}
              data-testid="band-divider"
              className="block h-16 w-px"
              style={DIVIDER_STYLE}
            />
          </div>
        </div>
      </dl>
    </div>
  )
}
