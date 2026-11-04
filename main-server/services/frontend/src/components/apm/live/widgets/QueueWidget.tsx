import { useContext, useEffect, useMemo, useRef } from 'react'
import { canvasFont, cssVar, prepareCanvas, useElementSize } from '@/lib/apm/canvas'
import { pickActive } from '@/lib/apm/liveData'
import { hitBar, queueBars, queueGeometry, withZeroBars } from '@/lib/apm/queueBuckets'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'

const COUNT_H = 14 // 막대 위 건수 라벨 영역
const LABEL_H = 18 // 막대 아래 이름 라벨 영역

const LEVEL_VAR = {
  normal: '--color-apm-normal',
  warning: '--color-apm-warning',
  critical: '--color-apm-critical',
} as const

/** 액티브 트랜잭션 이퀄라이저: WAS 별 막대, 경과 구간 3색. 막대 클릭 → 진행 중 목록 필터. */
export function QueueWidget({ events, target }: WidgetProps) {
  const { queueFilter, setQueueFilter, instanceLabel } = useContext(LiveContext)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = useElementSize(wrapRef)
  const idsKey = target.systemIds.join(',')
  const role = target.instanceRole
  const keysKey = target.instanceKeys?.join('\n')
  const bars = useMemo(() => {
    const keys = keysKey === undefined ? undefined : keysKey.split('\n').filter(Boolean)
    const active = pickActive(events.active, {
      systemIds: idsKey ? idsKey.split(',').map(Number) : [],
      instanceRole: role,
      instanceKeys: keys,
    })
    return withZeroBars(queueBars(active), keys)
  }, [events.active, idsKey, role, keysKey])

  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, width, height)
    if (!ctx) return
    const inner = Math.max(0, height - COUNT_H)
    const rects = queueGeometry(bars, width, inner, LABEL_H)
    const barBottom = Math.max(0, inner - LABEL_H)
    const colors = {
      normal: cssVar(LEVEL_VAR.normal),
      warning: cssVar(LEVEL_VAR.warning),
      critical: cssVar(LEVEL_VAR.critical),
      text: cssVar('--color-text-secondary'),
      count: cssVar('--color-text-primary'),
      base: cssVar('--color-border-alt'),
    }
    // 막대 바닥선: 0건 막대도 자리가 보이게 전체 폭에 기준선을 긋는다
    ctx.fillStyle = colors.base
    ctx.fillRect(0, COUNT_H + barBottom, width, 1)
    ctx.font = canvasFont(11)
    ctx.textAlign = 'center'
    const pitch = rects.length > 1 ? rects[1].x - rects[0].x : width
    const widest = Math.max(
      0,
      ...bars.map((b) => ctx.measureText(instanceLabel(b.system_id, b.instance_role)).width),
    )
    const labelStep = Math.max(1, Math.ceil((widest + 6) / Math.max(1, pitch)))
    let lastRight = -Infinity
    rects.forEach((r, i) => {
      const dim = queueFilter !== null && queueFilter !== r.key
      ctx.globalAlpha = dim ? 0.35 : 1
      for (const s of r.segs) {
        ctx.fillStyle = colors[s.level]
        ctx.fillRect(r.x, s.y + COUNT_H, r.w, s.h)
      }
      // 0건: 막대 자리에 2px 정상색 바닥 막대
      if (bars[i].total === 0) {
        ctx.fillStyle = colors.normal
        ctx.fillRect(r.x, COUNT_H + barBottom - 2, r.w, 2)
      }
      // 건수 라벨: 막대 위
      const topY = r.segs.length ? Math.min(...r.segs.map((s) => s.y)) : barBottom
      ctx.fillStyle = colors.count
      ctx.fillText(String(bars[i].total), r.x + r.w / 2, COUNT_H + topY - 4)
      ctx.globalAlpha = 1
      ctx.fillStyle = colors.text
      // 라벨 솎아내기: 막대 간격이 좁으면 k 개마다 하나만 그려 겹침을 막는다
      const full = instanceLabel(bars[i].system_id, bars[i].instance_role)
      if (i % labelStep !== 0) return
      const half = ctx.measureText(full).width / 2
      const cx = Math.min(Math.max(r.x + r.w / 2, half), width - half)
      if (cx - half < lastRight + 4) return
      lastRight = cx + half
      ctx.fillText(full, cx, height - 4)
    })
  }, [bars, width, height, queueFilter, instanceLabel])

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
        aria-label={`액티브 트랜잭션 큐: ${bars.map((b) => `${instanceLabel(b.system_id, b.instance_role)} ${b.total}건`).join(', ')}`}
        onClick={onClick}
        style={{ width, height }}
        className="cursor-pointer"
      />
      {bars.length === 0 && (
        <div className="text-text-tertiary pointer-events-none absolute inset-0 flex items-center justify-center text-xs">
          수신 대기
        </div>
      )}
    </div>
  )
}
