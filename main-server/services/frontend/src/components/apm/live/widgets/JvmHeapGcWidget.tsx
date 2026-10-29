import { jvmNum, mergeSeries, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

const MB = 1024 * 1024

export function JvmHeapGcWidget({ events, target }: WidgetProps) {
  const lists = pickAgg(events.agg, target)
  const heap = mergeSeries(
    lists,
    (e) => {
      const v = jvmNum(e, 'heap_used')
      return v == null ? null : v / MB
    },
    'sum',
  )
  const gcMs = mergeSeries(lists, (e) => jvmNum(e, 'gc_ms'), 'sum')
  const lastGc = gcMs.length > 1 ? gcMs[gcMs.length - 1].value - gcMs[gcMs.length - 2].value : 0
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="min-h-0 flex-1">
        <MiniChart
          lines={[{ label: '힙 사용(MB)', colorVar: '--color-accent', points: heap }]}
          format={(v) => `${Math.round(v)}MB`}
        />
      </div>
      <div className="text-text-secondary text-xs">
        최근 GC 시간{' '}
        <span className="text-text-primary font-semibold">{Math.max(0, Math.round(lastGc))}ms</span>
      </div>
    </div>
  )
}
