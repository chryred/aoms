import { useContext } from 'react'
import { pickAgg } from '@/lib/apm/liveData'
import { LiveContext } from '@/components/apm/live/LiveContext'
import type { WidgetProps } from '@/components/apm/live/widgetRegistry'
import { MiniChart } from './MiniChart'
import { seriesLines } from './seriesLines'

export function TpsWidget({ events, target }: WidgetProps) {
  const palette = useContext(LiveContext)
  const lines = seriesLines(pickAgg(events.agg, target), (e) => e.tps, 'sum', palette, {
    label: 'TPS',
    colorVar: '--color-accent',
  })
  return <MiniChart lines={lines} />
}
