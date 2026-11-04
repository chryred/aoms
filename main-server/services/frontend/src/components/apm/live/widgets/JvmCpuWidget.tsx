import { useContext } from 'react'
import { jvmNum, pickAgg } from '@/lib/apm/liveData'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'
import { seriesLines } from './seriesLines'

export function JvmCpuWidget({ events, target }: WidgetProps) {
  const palette = useContext(LiveContext)
  const lines = seriesLines(
    pickAgg(events.agg, target),
    (e) => {
      const v = jvmNum(e, 'cpu_ratio')
      return v == null ? null : v * 100
    },
    'mean',
    palette,
    { label: 'CPU', colorVar: '--color-warning' },
  )
  return <MiniChart lines={lines} format={(v) => `${v.toFixed(1)}%`} />
}
