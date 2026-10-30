import { useContext, useEffect, useMemo, useRef } from 'react'
import { canvasFont, cssVar, prepareCanvas, useElementSize } from '@/lib/apm/canvas'
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
  const idsKey = target.systemIds.join(',')
  const role = target.instanceRole
  const bars = useMemo(
    () =>
      queueBars(
        pickActive(events.active, {
          systemIds: idsKey ? idsKey.split(',').map(Number) : [],
          instanceRole: role,
        }),
      ),
    [events.active, idsKey, role],
  )

  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, width, height)
    if (!ctx) return
    const rects = queueGeometry(bars, width, height)
    const colors = {
      normal: cssVar(LEVEL_VAR.normal),
      warning: cssVar(LEVEL_VAR.warning),
      critical: cssVar(LEVEL_VAR.critical),
      text: cssVar('--color-text-secondary'),
    }
    ctx.font = canvasFont(11)
    ctx.textAlign = 'center'
    const pitch = rects.length > 1 ? rects[1].x - rects[0].x : width
    const widest = Math.max(
      0,
      ...bars.map((b) => ctx.measureText(`${systemName(b.system_id)}/${b.instance_role}`).width),
    )
    const labelStep = Math.max(1, Math.ceil((widest + 6) / Math.max(1, pitch)))
    let lastRight = -Infinity
    rects.forEach((r, i) => {
      const dim = queueFilter !== null && queueFilter !== r.key
      ctx.globalAlpha = dim ? 0.35 : 1
      for (const s of r.segs) {
        ctx.fillStyle = colors[s.level]
        ctx.fillRect(r.x, s.y, r.w, s.h)
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = colors.text
      // 라벨 솎아내기: 막대 간격이 좁으면 k 개마다 하나만 그려 겹침을 막는다
      const full = `${systemName(bars[i].system_id)}/${bars[i].instance_role}`
      if (i % labelStep !== 0) return
      const half = ctx.measureText(full).width / 2
      const cx = Math.min(Math.max(r.x + r.w / 2, half), width - half)
      if (cx - half < lastRight + 4) return
      lastRight = cx + half
      ctx.fillText(full, cx, height - 4)
    })
  }, [bars, width, height, queueFilter, systemName])

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
