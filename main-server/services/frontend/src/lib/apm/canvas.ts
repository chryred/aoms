import { useEffect, useState, type RefObject } from 'react'
import { normalizeUtc } from '@/lib/utils'

/** 디자인 토큰(CSS 변수) 값을 읽는다. 하드코딩 색 금지 — Canvas 는 이 함수로만 색을 얻는다. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Canvas 텍스트용 앱 폰트(--font-sans). 하드코딩 'sans-serif' 금지. */
export function canvasFont(px: number): string {
  return `${px}px ${cssVar('--font-sans') || 'sans-serif'}`
}

/** 해상도(DPR) 보정 후 2D 컨텍스트 반환. jsdom 등 canvas 미지원이면 null. */
export function prepareCanvas(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}

/** 요소 크기를 추적(ResizeObserver). 미지원 환경에서는 초기값 유지. */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  initial = { width: 300, height: 160 },
) {
  const [size, setSize] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/** API 가 ISO 문자열 또는 ms epoch 로 줄 수 있는 시각을 ms 로 통일. */
export function toMs(ts: number | string): number {
  return typeof ts === 'number' ? ts : Date.parse(normalizeUtc(ts))
}

export function niceMax(v: number): number {
  if (v <= 0) return 1000
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

export interface ScatterScale {
  x: (ts: number) => number
  y: (ms: number) => number
  invX: (px: number) => number
  invY: (py: number) => number
}

export interface Pad {
  l: number
  r: number
  t: number
  b: number
}

export function scatterScale(
  tMin: number,
  tMax: number,
  yMax: number,
  width: number,
  height: number,
  pad: Pad,
): ScatterScale {
  const pw = Math.max(1, width - pad.l - pad.r)
  const ph = Math.max(1, height - pad.t - pad.b)
  const span = Math.max(1, tMax - tMin)
  return {
    x: (ts) => pad.l + ((ts - tMin) / span) * pw,
    y: (ms) => pad.t + ph - (Math.min(ms, yMax) / yMax) * ph,
    invX: (px) => tMin + ((px - pad.l) / pw) * span,
    invY: (py) => ((pad.t + ph - py) / ph) * yMax,
  }
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 드래그 사각형(픽셀) 안에 들어오는 점. */
export function pointsInRect<T extends { ts: number; elapsed_ms: number }>(
  points: T[],
  scale: ScatterScale,
  rect: Rect,
): T[] {
  const xa = Math.min(rect.x0, rect.x1)
  const xb = Math.max(rect.x0, rect.x1)
  const ya = Math.min(rect.y0, rect.y1)
  const yb = Math.max(rect.y0, rect.y1)
  return points.filter((p) => {
    const px = scale.x(p.ts)
    const py = scale.y(p.elapsed_ms)
    return px >= xa && px <= xb && py >= ya && py <= yb
  })
}
