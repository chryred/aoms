import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { Activity } from 'lucide-react'
import { tracesApi } from '@/api/traces'
import { useUiStore } from '@/store/uiStore'
import { formatKST, cn } from '@/lib/utils'
import type { TraceDotPoint } from '@/api/traces'

interface TraceDotChartProps {
  systemId: number
  systemName?: string
  windowMinutes?: number
  height?: number
  onTraceSelect?: (traceId: string) => void
}

interface TooltipPayloadEntry {
  payload: TraceDotPoint
}

function DotTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadEntry[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="border-border bg-bg-base shadow-neu-flat max-w-xs rounded-sm border p-2 text-xs">
      <p className="text-text-primary mb-0.5 font-semibold">
        {d.name ?? d.traceID.slice(0, 8) + '…'}
      </p>
      <p className="text-text-secondary">
        {d.durationMs.toFixed(0)}ms · {formatKST(new Date(d.ts).toISOString(), 'HH:mm:ss')}
      </p>
      {d.error && <p className="text-critical font-semibold">에러</p>}
      {!d.error && d.slow && <p className="text-warning font-semibold">느린 요청</p>}
    </div>
  )
}

// Recharts Scatter custom dot — r 반지름 축소(2)
interface DotShapeProps {
  cx?: number
  cy?: number
  payload?: TraceDotPoint
}
function SmallDot(props: DotShapeProps) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload) return null
  return <circle cx={cx} cy={cy} r={2} fill={dotColor(payload)} fillOpacity={0.9} />
}

const COLOR_OK = '#00D4FF'
const COLOR_ERR = '#EF4444'
const COLOR_SLOW = '#F59E0B'
const EXPAND_DURATION = 340
const COLLAPSE_DURATION = 280

function dotColor(d: TraceDotPoint): string {
  if (d.error) return COLOR_ERR
  if (d.slow) return COLOR_SLOW
  return COLOR_OK
}

// Recharts ScatterChart margin + YAxis width 기준 plot area 추정
const PLOT_LEFT_PAD = 66
const PLOT_RIGHT_PAD = 10
const PLOT_TOP_PAD = 10
const PLOT_BOTTOM_PAD = 20

interface ExpandRects {
  from: DOMRect
  to: DOMRect
}

interface ChartCoreProps {
  dots: TraceDotPoint[]
  xDomain: [number, number]
  yMax: number
  theme: 'dark' | 'light'
  onTraceSelect?: (traceId: string) => void
}

function ChartCore({ dots, xDomain, yMax, theme, onTraceSelect }: ChartCoreProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<{ x1: number; y1: number } | null>(null)

  // 선택 완료 후 팝오버에 표시할 dots + 위치
  const [selectedDots, setSelectedDots] = useState<TraceDotPoint[]>([])
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const gridColor = theme === 'dark' ? '#2B2F37' : '#E5E7EB'
  const tickColor = theme === 'dark' ? '#8B97AD' : '#6B7280'

  // 픽셀(chart 내부) → (timestamp, durationMs)
  const pixelToData = useCallback(
    (
      localX: number,
      localY: number,
      chartWidth: number,
      chartHeight: number,
    ): { ts: number; dur: number } => {
      const plotW = chartWidth - PLOT_LEFT_PAD - PLOT_RIGHT_PAD
      const plotH = chartHeight - PLOT_TOP_PAD - PLOT_BOTTOM_PAD
      const xRatio = Math.max(0, Math.min(1, (localX - PLOT_LEFT_PAD) / Math.max(plotW, 1)))
      const yRatio = Math.max(0, Math.min(1, (localY - PLOT_TOP_PAD) / Math.max(plotH, 1)))
      const ts = xDomain[0] + xRatio * (xDomain[1] - xDomain[0])
      // yAxis는 top이 max, bottom이 0 → invert
      const dur = yMax * (1 - yRatio)
      return { ts, dur }
    },
    [xDomain, yMax],
  )

  // native mousedown/move/up — React re-render 유발하지 않음 (DOM mutation)
  useEffect(() => {
    const wrapper = wrapperRef.current
    const overlay = overlayRef.current
    if (!wrapper || !overlay) return

    let isDragging = false

    const applyRect = (x1: number, y1: number, x2: number, y2: number) => {
      const lx = Math.min(x1, x2)
      const rx = Math.max(x1, x2)
      const ty = Math.min(y1, y2)
      const by = Math.max(y1, y2)
      overlay.style.display = 'block'
      overlay.style.left = `${lx}px`
      overlay.style.top = `${ty}px`
      overlay.style.width = `${rx - lx}px`
      overlay.style.height = `${by - ty}px`
    }

    const hideRect = () => {
      overlay.style.display = 'none'
    }

    const onDown = (e: MouseEvent) => {
      // 팝오버/tooltip 등 chart 밖은 무시
      if (!wrapper.contains(e.target as Node)) return
      // 팝오버 내부 클릭이면 무시
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) return

      const rect = wrapper.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      dragStateRef.current = { x1: x, y1: y }
      isDragging = true
      applyRect(x, y, x, y)
      setPopoverPos(null)
      setSelectedDots([])
      e.preventDefault()
    }

    const onMove = (e: MouseEvent) => {
      if (!isDragging || !dragStateRef.current) return
      const rect = wrapper.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      applyRect(dragStateRef.current.x1, dragStateRef.current.y1, x, y)
    }

    const onUp = (e: MouseEvent) => {
      if (!isDragging || !dragStateRef.current) return
      isDragging = false
      const rect = wrapper.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const start = dragStateRef.current
      dragStateRef.current = null
      hideRect()

      const dx = Math.abs(x - start.x1)
      const dy = Math.abs(y - start.y1)
      if (dx < 4 && dy < 4) {
        // 거의 이동 없음 — 선택 취소
        return
      }

      const chartWidth = wrapper.clientWidth
      const chartHeight = wrapper.clientHeight
      const a = pixelToData(start.x1, start.y1, chartWidth, chartHeight)
      const b = pixelToData(x, y, chartWidth, chartHeight)
      const tsLo = Math.min(a.ts, b.ts)
      const tsHi = Math.max(a.ts, b.ts)
      const durLo = Math.min(a.dur, b.dur)
      const durHi = Math.max(a.dur, b.dur)

      const hits = dots.filter(
        (d) => d.ts >= tsLo && d.ts <= tsHi && d.durationMs >= durLo && d.durationMs <= durHi,
      )
      setSelectedDots(hits)

      const containerRect = wrapper.getBoundingClientRect()
      setPopoverPos({
        x: Math.min(e.clientX - containerRect.left, containerRect.width - 280),
        y: e.clientY - containerRect.top,
      })
    }

    wrapper.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      wrapper.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dots, pixelToData])

  // 팝오버 외부 클릭 시 닫기
  useEffect(() => {
    if (!popoverPos) return
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverPos(null)
        setSelectedDots([])
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [popoverPos])

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full select-none"
      style={{ cursor: 'crosshair' }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          margin={{ top: PLOT_TOP_PAD, right: PLOT_RIGHT_PAD, bottom: PLOT_BOTTOM_PAD, left: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={xDomain}
            scale="time"
            tickFormatter={(v: number) => formatKST(new Date(v).toISOString(), 'HH:mm')}
            stroke={gridColor}
            tick={{ fill: tickColor, fontSize: 10 }}
            allowDataOverflow
          />
          <YAxis
            dataKey="durationMs"
            type="number"
            domain={[0, yMax]}
            unit="ms"
            stroke={gridColor}
            tick={{ fill: tickColor, fontSize: 10 }}
            width={56}
            label={{
              value: '응답시간(ms)',
              angle: -90,
              position: 'insideLeft',
              fill: tickColor,
              fontSize: 10,
              offset: 10,
            }}
          />
          <Tooltip content={<DotTooltip />} cursor={false} />
          <Scatter
            data={dots}
            isAnimationActive={false}
            shape={<SmallDot />}
            onClick={(data: { payload?: TraceDotPoint }) => {
              const tid = data?.payload?.traceID
              if (tid && onTraceSelect) onTraceSelect(tid)
            }}
          >
            {dots.map((d, i) => (
              <Cell key={i} fill={dotColor(d)} fillOpacity={0.9} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Drag rectangle overlay — native DOM, re-render 無 */}
      <div
        ref={overlayRef}
        className="pointer-events-none absolute border"
        style={{
          display: 'none',
          background: `${COLOR_OK}20`,
          borderColor: `${COLOR_OK}80`,
          zIndex: 10,
        }}
      />

      {/* Trace 목록 팝오버 */}
      {popoverPos && selectedDots.length > 0 && (
        <div
          ref={popoverRef}
          className="border-border bg-bg-base shadow-neu-flat absolute z-20 max-h-[320px] w-[280px] overflow-y-auto rounded-sm border p-2"
          style={{
            left: Math.max(8, popoverPos.x),
            top: Math.min(popoverPos.y + 8, (wrapperRef.current?.clientHeight ?? 400) - 200),
          }}
        >
          <div className="text-text-secondary mb-2 flex items-center justify-between text-xs">
            <span>선택된 Trace ({selectedDots.length}건)</span>
            <button
              onClick={() => {
                setPopoverPos(null)
                setSelectedDots([])
              }}
              className="text-text-disabled hover:text-text-primary"
            >
              ✕
            </button>
          </div>
          <div className="space-y-1">
            {selectedDots.slice(0, 50).map((d) => (
              <button
                key={d.traceID}
                onClick={() => {
                  onTraceSelect?.(d.traceID)
                  setPopoverPos(null)
                  setSelectedDots([])
                }}
                className={cn(
                  'hover:bg-hover-subtle flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-xs transition-colors',
                  d.error && 'bg-[rgba(239,68,68,0.06)]',
                  !d.error && d.slow && 'bg-[rgba(245,158,11,0.06)]',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span
                    className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                    style={{ backgroundColor: dotColor(d) }}
                  />
                  <span className="text-text-primary font-mono">{d.traceID.slice(0, 8)}…</span>
                  <span className="text-text-secondary ml-2">{d.name ?? '?'}</span>
                </span>
                <span className="text-text-disabled ml-2 shrink-0 tabular-nums">
                  {d.durationMs.toFixed(0)}ms
                </span>
              </button>
            ))}
            {selectedDots.length > 50 && (
              <p className="text-text-disabled py-1 text-center text-[10px]">
                … 외 {selectedDots.length - 50}건 더 있음 (범위를 좁혀 주세요)
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// FLIP 확대 패널 — content 영역(main)의 bounds로 팽창
function ExpandedPanel({
  rects,
  isClosing,
  systemName,
  dots,
  xDomain,
  yMax,
  theme,
  onTraceSelect,
  onClose,
}: {
  rects: ExpandRects
  isClosing: boolean
  systemName?: string
  dots: TraceDotPoint[]
  xDomain: [number, number]
  yMax: number
  theme: 'dark' | 'light'
  onTraceSelect?: (traceId: string) => void
  onClose: () => void
}) {
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
    <div style={panelStyle} className="bg-bg-base">
      <div className="flex h-full flex-col p-5" onDoubleClick={onClose}>
        <div className="mb-3 flex shrink-0 items-center justify-between">
          <h3 className="type-heading text-text-primary text-base font-semibold">
            성능 분석{systemName ? ` · ${systemName}` : ''}
          </h3>
          <span className="text-text-disabled cursor-zoom-out text-[10px] select-none">
            더블클릭 또는 ESC로 닫기 · 영역 드래그로 Trace 선택
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <ChartCore
            dots={dots}
            xDomain={xDomain}
            yMax={yMax}
            theme={theme}
            onTraceSelect={onTraceSelect}
          />
        </div>
      </div>
    </div>
  )
}

export function TraceDotChart({
  systemId,
  systemName,
  windowMinutes = 60,
  height = 260,
  onTraceSelect,
}: TraceDotChartProps) {
  const theme = useUiStore((s) => s.theme)
  const cardRef = useRef<HTMLDivElement>(null)

  const [expandRects, setExpandRects] = useState<ExpandRects | null>(null)
  const [isClosing, setIsClosing] = useState(false)

  const { data: metrics } = useQuery({
    queryKey: ['traceMetrics', systemId, windowMinutes],
    queryFn: () => tracesApi.getTraceMetrics(systemId, windowMinutes),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  const dots = useMemo(() => metrics?.dots ?? [], [metrics])

  const xDomain = useMemo<[number, number]>(() => {
    if (dots.length === 0) {
      const now = Date.now()
      return [now - windowMinutes * 60_000, now]
    }
    const min = Math.min(...dots.map((d) => d.ts))
    const max = Math.max(...dots.map((d) => d.ts))
    const pad = Math.max(30_000, (max - min) * 0.05)
    return [min - pad, max + pad]
  }, [dots, windowMinutes])

  const yMax = useMemo(() => {
    if (dots.length === 0) return 100
    const max = Math.max(...dots.map((d) => d.durationMs))
    return Math.ceil(max * 1.2) || 100
  }, [dots])

  const handleExpand = useCallback(() => {
    if (!cardRef.current) return
    const fromRect = cardRef.current.getBoundingClientRect()
    const main = document.querySelector('main')
    if (!main) return
    const toRect = main.getBoundingClientRect()
    setExpandRects({ from: fromRect, to: toRect })
    setIsClosing(false)
  }, [])

  const handleClose = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      setExpandRects(null)
      setIsClosing(false)
    }, COLLAPSE_DURATION + 20)
  }, [])

  return (
    <>
      <div
        ref={cardRef}
        className="border-border bg-surface shadow-neu-flat relative cursor-zoom-in rounded-sm border p-3"
        onDoubleClick={handleExpand}
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity className="text-accent h-3.5 w-3.5" />
            <span className="text-text-secondary text-xs font-medium">
              성능 분석{systemName ? ` · ${systemName}` : ''}
            </span>
            <span className="text-text-disabled ml-1 text-[10px]">
              (영역 드래그 → Trace 선택 · 더블클릭 → 확대)
            </span>
          </div>
          {metrics && (
            <div className="text-text-secondary flex gap-3 text-xs">
              <span>샘플 {metrics.total}건</span>
              <span className={metrics.error_count > 0 ? 'text-critical' : ''}>
                에러 {metrics.error_count}건
              </span>
              <span className={metrics.slow_count > 0 ? 'text-warning' : ''}>
                느린 {metrics.slow_count}건
              </span>
              <span>p95 {metrics.p95_ms.toFixed(0)}ms</span>
            </div>
          )}
        </div>
        <div style={{ height }}>
          {dots.length > 0 ? (
            <ChartCore
              dots={dots}
              xDomain={xDomain}
              yMax={yMax}
              theme={theme}
              onTraceSelect={onTraceSelect}
            />
          ) : (
            <div className="text-text-disabled flex h-full items-center justify-center text-xs">
              추적 데이터 없음
            </div>
          )}
        </div>

        <div className="mt-1 flex items-center justify-end gap-3 text-[10px]">
          <span className="text-text-secondary flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: COLOR_OK }}
            />
            정상
          </span>
          <span className="text-text-secondary flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: COLOR_SLOW }}
            />
            느린
          </span>
          <span className="text-text-secondary flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: COLOR_ERR }}
            />
            에러
          </span>
        </div>
      </div>

      {expandRects &&
        createPortal(
          <ExpandedPanel
            rects={expandRects}
            isClosing={isClosing}
            systemName={systemName}
            dots={dots}
            xDomain={xDomain}
            yMax={yMax}
            theme={theme}
            onTraceSelect={onTraceSelect}
            onClose={handleClose}
          />,
          document.body,
        )}
    </>
  )
}
