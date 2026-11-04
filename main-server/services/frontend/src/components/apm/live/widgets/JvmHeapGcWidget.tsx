import { useContext } from 'react'
import { jvmNum, mergeSeries, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { LiveContext } from '@/components/apm/live/LiveContext'
import { MiniChart } from './MiniChart'
import { seriesLines } from './seriesLines'

const MB = 1024 * 1024

export function JvmHeapGcWidget({ events, target }: WidgetProps) {
  const lists = pickAgg(events.agg, target)
  const palette = useContext(LiveContext)
  const heap = seriesLines(
    lists,
    (e) => {
      const v = jvmNum(e, 'heap_used')
      return v == null ? null : v / MB
    },
    'sum',
    palette,
    { label: '힙 사용(MB)', colorVar: '--color-accent' },
  )
  const gcMs = mergeSeries(lists, (e) => jvmNum(e, 'gc_ms'), 'sum')
  const lastGc = gcMs.length > 1 ? gcMs[gcMs.length - 1].value - gcMs[gcMs.length - 2].value : 0
  return (
    <MiniChart
      lines={heap}
      format={(v) => `${Math.round(v)}MB`}
      extra={
        <>
          최근 GC 시간{' '}
          <span className="text-text-primary font-semibold tabular-nums">
            {Math.max(0, Math.round(lastGc))}ms
          </span>
        </>
      }
    />
  )
}
