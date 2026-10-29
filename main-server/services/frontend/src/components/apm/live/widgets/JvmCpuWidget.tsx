import { jvmNum, mergeSeries, pickAgg } from '@/lib/apm/liveData'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'

export function JvmCpuWidget({ events, target }: WidgetProps) {
  const cpu = mergeSeries(
    pickAgg(events.agg, target),
    (e) => {
      const v = jvmNum(e, 'cpu_ratio')
      return v == null ? null : v * 100
    },
    'mean',
  )
  return (
    <MiniChart
      lines={[{ label: 'CPU', colorVar: '--color-warning', points: cpu }]}
      format={(v) => `${v.toFixed(1)}%`}
    />
  )
}
