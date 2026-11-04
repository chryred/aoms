import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { canvasFont, cssVar, prepareCanvas, useElementSize } from '@/lib/apm/canvas'
import { pickActive } from '@/lib/apm/liveData'
import { hitBar, queueBars, queueTowers, withZeroBars } from '@/lib/apm/queueBuckets'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'

const COUNT_H = 14 // 막대 위 건수 라벨 영역
const LABEL_H = 18 // 막대 아래 이름 라벨 영역

const LEVEL_VAR = {
  normal: '--color-apm-normal',
  warning: '--color-apm-warning',
  critical: '--color-apm-critical',
} as const

/** 액티브 트랜잭션 블록 탑: WAS 별 한 칼럼, 진행 중 1건 = 블록 1개(경과 구간 3색, 위험이 맨 아래). 클릭 → 진행 중 목록 필터, 호버 → 건수 툴팁. */
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

  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const ctx = prepareCanvas(canvasRef.current, width, height)
    if (!ctx) return
    const inner = Math.max(0, height - COUNT_H)
    const plotH = Math.max(0, inner - LABEL_H)
    const towers = queueTowers(bars, width, plotH)
    const colors = {
      normal: cssVar(LEVEL_VAR.normal),
      warning: cssVar(LEVEL_VAR.warning),
      critical: cssVar(LEVEL_VAR.critical),
      text: cssVar('--color-text-secondary'),
      count: cssVar('--color-text-primary'),
      base: cssVar('--color-border-alt'),
    }
    // 바닥 기준선: 0건 호스트도 자리가 보이게 전체 폭에 긋는다
    ctx.fillStyle = colors.base
    ctx.fillRect(0, COUNT_H + plotH, width, 1)
    ctx.font = canvasFont(11)
    ctx.textAlign = 'center'
    const pitch = towers.length > 1 ? towers[1].cx - towers[0].cx : width
    const widest = Math.max(
      0,
      ...bars.map((b) => ctx.measureText(instanceLabel(b.system_id, b.instance_role)).width),
    )
    const labelStep = Math.max(1, Math.ceil((widest + 6) / Math.max(1, pitch)))
    let lastRight = -Infinity
    towers.forEach((t, i) => {
      const x = t.cx - t.w / 2
      const dim = queueFilter !== null && queueFilter !== t.key
      ctx.globalAlpha = dim ? 0.35 : 1
      for (const blk of t.blocks) {
        ctx.fillStyle = colors[blk.level]
        ctx.fillRect(x, blk.y + COUNT_H, t.w, t.h)
      }
      // 0건: 색 막대 대신 빈 슬롯(점선 윤곽) 한 칸
      if (bars[i].total === 0) {
        ctx.strokeStyle = colors.base
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        ctx.strokeRect(x + 0.5, t.baseY + COUNT_H + 0.5, t.w - 1, t.h - 1)
        ctx.setLineDash([])
      }
      // 넘친 건수: 블록 위 한 칸에 "+N"
      ctx.fillStyle = colors.text
      ctx.font = canvasFont(10)
      if (t.overflow > 0) ctx.fillText(`+${t.overflow}`, t.cx, COUNT_H + t.topY + t.h - 1)
      // 총 건수: 탑 위
      ctx.font = canvasFont(11)
      ctx.fillStyle = colors.count
      ctx.fillText(String(bars[i].total), t.cx, COUNT_H + t.topY - 4)
      ctx.globalAlpha = 1
      ctx.fillStyle = colors.text
      // 라벨 솎아내기: 탑 간격이 좁으면 k 개마다 하나만 그려 겹침을 막는다
      const full = instanceLabel(bars[i].system_id, bars[i].instance_role)
      if (i % labelStep !== 0) return
      const half = ctx.measureText(full).width / 2
      const cx = Math.min(Math.max(t.cx, half), width - half)
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

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left
    const key = hitBar(bars, width, x)
    setHover(key ? { key, x, y: e.clientY - box.top } : null)
  }
  const hovered = hover ? bars.find((b) => b.key === hover.key) : undefined

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`액티브 트랜잭션 큐: ${bars.map((b) => `${instanceLabel(b.system_id, b.instance_role)} ${b.total}건`).join(', ')}`}
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ width, height }}
        className="cursor-pointer"
      />
      {hover && hovered && (
        <div
          role="tooltip"
          className="bg-bg-base text-text-primary shadow-neu-soft pointer-events-none absolute z-10 rounded-sm px-2 py-1 text-xs whitespace-nowrap"
          style={{
            left: Math.min(Math.max(hover.x + 10, 0), Math.max(0, width - 130)),
            top: Math.max(0, hover.y - 52),
          }}
        >
          <div className="font-medium">
            {instanceLabel(hovered.system_id, hovered.instance_role)}
          </div>
          <div className="text-text-secondary">
            총 {hovered.total}건 ·{' '}
            <span className="text-apm-critical-text">심각 {hovered.buckets[2]}</span> ·{' '}
            <span className="text-apm-warning-text">경고 {hovered.buckets[1]}</span> ·{' '}
            <span className="text-apm-normal-text">정상 {hovered.buckets[0]}</span>
          </div>
        </div>
      )}
      {bars.length === 0 && (
        <div className="text-text-tertiary pointer-events-none absolute inset-0 flex items-center justify-center text-xs">
          수신 대기
        </div>
      )}
    </div>
  )
}
