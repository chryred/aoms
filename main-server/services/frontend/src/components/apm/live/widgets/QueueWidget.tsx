import { useContext, useEffect, useRef } from 'react'
import { cssVar, prepareCanvas, useElementSize } from '@/lib/apm/canvas'
import { pickActive } from '@/lib/apm/liveData'
import { hitBar, queueBars, queueGeometry } from '@/lib/apm/queueBuckets'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'

const LEVEL_VAR = {
  normal: '--color-normal',
  warning: '--color-warning',
  critical: '--color-critical',
} as const

/** 액티브 트랜잭션 이퀄라이저: WAS 별 막대, 경과 구간 3색. 막대 클릭 → 진행 중 목록 필터. */
export function QueueWidget({ events, target }: WidgetProps) {
  const { queueFilter, setQueueFilter, systemName } = useContext(LiveContext)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(wrapRef)
  const bars = queueBars(pickActive(events.active, target))

  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, width, height)
    if (!ctx) return
    const rects = queueGeometry(bars, width, height)
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    rects.forEach((r, i) => {
      const dim = queueFilter !== null && queueFilter !== r.key
      ctx.globalAlpha = dim ? 0.35 : 1
      for (const s of r.segs) {
        ctx.fillStyle = cssVar(LEVEL_VAR[s.level])
        ctx.fillRect(r.x, s.y, r.w, s.h)
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = cssVar('--color-text-secondary')
      ctx.fillText(
        `${systemName(bars[i].system_id)}/${bars[i].instance_role}`.slice(0, 14),
        r.x + r.w / 2,
        height - 4,
      )
    })
  })

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const key = hitBar(bars, width, e.clientX - box.left)
    setQueueFilter(key === queueFilter ? null : key)
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="액티브 트랜잭션 큐"
        onClick={onClick}
        style={{ width, height }}
        className="cursor-pointer"
      />
      {bars.length === 0 && (
        <div className="text-text-tertiary pointer-events-none absolute inset-0 flex items-center justify-center text-xs">
          수신 중인 인스턴스 없음
        </div>
      )}
    </div>
  )
}
