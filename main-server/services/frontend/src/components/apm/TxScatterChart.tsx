import { useMemo, useRef, useState } from 'react'
import { niceMax, scatterScale, toMs, useElementSize } from '@/lib/apm/canvas'
import { formatKST } from '@/lib/utils'
import type { TxSummary } from '@/types/apm'
import { txKey, type TxBrush } from '@/lib/apm/txUtils'

const HEIGHT = 220
const PAD = { l: 46, r: 10, t: 10, b: 22 }
const MIN_DRAG_PX = 4

interface Props {
  items: TxSummary[]
  selectedKey: string | null
  brush: TxBrush | null
  onBrush: (b: TxBrush | null) => void
}

/** 조회 결과의 응답 시간 산점도 — 정상·에러=APM 상태 색(--color-apm-normal/critical, 에러는 위에 그림), 선택 건은 큰 링. 드래그로 영역을 고르면 목록이 좁혀진다. */
export function TxScatterChart({ items, selectedKey, brush, onBrush }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const { width } = useElementSize(wrapRef)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const { scale, tMin, tMax, yMax, pts } = useMemo(() => {
    const ts = items.map((t) => toMs(t.start_ts))
    const lo = ts.length ? Math.min(...ts) : 0
    const hi = ts.length ? Math.max(...ts) : 1
    const padT = Math.max(1000, (hi - lo) * 0.02)
    const y = niceMax(Math.max(1, ...items.map((t) => t.elapsed_ms)) * 1.05)
    const sc = scatterScale(lo - padT, hi + padT, y, width, HEIGHT, PAD)
    const all = items.map((t, i) => ({ tx: t, ts: ts[i], key: txKey(t) }))
    // 에러가 항상 위에 보이도록 마지막에 그린다
    const sorted = [...all].sort((a, b) => Number(!!a.tx.error) - Number(!!b.tx.error))
    return { scale: sc, tMin: lo - padT, tMax: hi + padT, yMax: y, pts: sorted }
  }, [items, width])

  const local = (e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const commit = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    if (Math.abs(d.x1 - d.x0) < MIN_DRAG_PX && Math.abs(d.y1 - d.y0) < MIN_DRAG_PX) return
    const ta = scale.invX(Math.min(d.x0, d.x1))
    const tb = scale.invX(Math.max(d.x0, d.x1))
    // y 는 위가 큰 값
    const ya = scale.invY(Math.max(d.y0, d.y1))
    const yb = scale.invY(Math.min(d.y0, d.y1))
    onBrush({ t0: ta, t1: tb, y0: Math.max(0, ya), y1: yb })
  }

  const box = drag
    ? {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }
    : brush
      ? {
          x: scale.x(brush.t0),
          y: scale.y(brush.y1),
          w: scale.x(brush.t1) - scale.x(brush.t0),
          h: scale.y(brush.y0) - scale.y(brush.y1),
        }
      : null

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)
  const xTicks = [0, 0.5, 1].map((f) => tMin + f * (tMax - tMin))
  const sel = pts.find((p) => p.key === selectedKey)

  return (
    <div ref={wrapRef} className="relative w-full select-none" style={{ height: HEIGHT }}>
      <svg
        role="img"
        aria-label="응답 시간 산점도"
        width={width}
        height={HEIGHT}
        className="block"
        data-testid="tx-scatter"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={width - PAD.r}
              y1={scale.y(v)}
              y2={scale.y(v)}
              stroke="var(--color-border)"
              strokeWidth={1}
              opacity={0.6}
            />
            <text
              x={PAD.l - 6}
              y={scale.y(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-text-secondary)"
              className="font-num"
            >
              {Math.round(v).toLocaleString()}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={scale.x(t)}
            y={HEIGHT - 6}
            textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
            fontSize={10}
            fill="var(--color-text-secondary)"
            className="font-num"
          >
            {formatKST(new Date(t), 'HH:mm:ss')}
          </text>
        ))}
        {pts.map((p) => (
          <circle
            key={p.key}
            data-testid={p.tx.error ? 'tx-dot-error' : 'tx-dot'}
            cx={scale.x(p.ts)}
            cy={scale.y(p.tx.elapsed_ms)}
            r={2}
            fill={p.tx.error ? 'var(--color-apm-critical)' : 'var(--color-apm-normal)'}
            opacity={p.tx.error ? 1 : 0.8}
          />
        ))}
        {sel && (
          <g data-testid="tx-dot-selected" pointerEvents="none">
            <circle
              cx={scale.x(sel.ts)}
              cy={scale.y(sel.tx.elapsed_ms)}
              r={7}
              fill="var(--color-text-secondary)"
              opacity={0.35}
              stroke="var(--color-text-primary)"
              strokeWidth={1}
            />
            <circle
              cx={scale.x(sel.ts)}
              cy={scale.y(sel.tx.elapsed_ms)}
              r={2.5}
              fill="var(--color-text-primary)"
            />
          </g>
        )}
        {box && (
          <rect
            data-testid="tx-brush"
            x={box.x}
            y={box.y}
            width={Math.max(0, box.w)}
            height={Math.max(0, box.h)}
            fill="var(--color-accent)"
            fillOpacity={0.12}
            stroke="var(--color-accent)"
            strokeWidth={1}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
        <rect
          data-testid="tx-scatter-overlay"
          x={PAD.l}
          y={PAD.t}
          width={Math.max(0, width - PAD.l - PAD.r)}
          height={HEIGHT - PAD.t - PAD.b}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onMouseDown={(e) => {
            const p = local(e)
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
          onMouseMove={(e) => {
            if (!drag) return
            const p = local(e)
            setDrag({ ...drag, x1: p.x, y1: p.y })
          }}
          onMouseUp={(e) => {
            if (!drag) return
            const p = local(e)
            commit({ ...drag, x1: p.x, y1: p.y })
            setDrag(null)
          }}
          onMouseLeave={() => setDrag(null)}
        />
      </svg>
    </div>
  )
}
